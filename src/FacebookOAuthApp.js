import React, { useState, useEffect } from 'react';
import { AlertCircle, Download, CheckCircle, User, Settings, CreditCard, BarChart3 } from 'lucide-react';
import MetaCampaignExtractor from './MetaCampaignExtractor';

const FacebookOAuthApp = () => {
  const [step, setStep] = useState('credentials'); // 'credentials', 'oauth', 'accounts', 'complete', 'extractor'
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [adAccounts, setAdAccounts] = useState([]);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [envContent, setEnvContent] = useState('');

  // OAuth redirect URI - should match what's configured in Facebook App
  const redirectUri = `${window.location.origin}/oauth-callback`;

  // Step 1: Handle credentials input
  const handleCredentialsSubmit = () => {
    if (!appId || !appSecret) {
      setError('Please enter both App ID and App Secret');
      return;
    }
    setError('');
    setStep('oauth');
  };

  // Step 2: Initiate Facebook OAuth
  const initiateOAuth = () => {
    const scope = 'ads_management,ads_read,business_management';
    const state = Math.random().toString(36).substring(7); // Simple state for CSRF protection
    localStorage.setItem('oauth_state', state);
    localStorage.setItem('app_id', appId);
    localStorage.setItem('app_secret', appSecret);
    
    const oauthUrl = `https://www.facebook.com/v18.0/dialog/oauth?` +
      `client_id=${appId}&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `scope=${scope}&` +
      `response_type=code&` +
      `state=${state}`;
    
    window.location.href = oauthUrl;
  };

  // Step 3: Handle OAuth callback
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const state = urlParams.get('state');
    const error = urlParams.get('error');

    if (error) {
      setError(`OAuth error: ${error}`);
      setStep('credentials');
      // Clear URL parameters
      window.history.replaceState({}, document.title, window.location.pathname);
      return;
    }

    if (code && state) {
      // Check if we've already processed this code
      const processedCode = localStorage.getItem('processed_code');
      if (processedCode === code) {
        // Code already processed, just show the accounts step
        const storedAppId = localStorage.getItem('app_id');
        const storedAppSecret = localStorage.getItem('app_secret');
        const storedToken = localStorage.getItem('access_token');
        const storedAccounts = localStorage.getItem('ad_accounts');
        
        if (storedAppId && storedAppSecret && storedToken && storedAccounts) {
          setAppId(storedAppId);
          setAppSecret(storedAppSecret);
          setAccessToken(storedToken);
          setAdAccounts(JSON.parse(storedAccounts));
          setStep('accounts');
        }
        return;
      }

      const storedState = localStorage.getItem('oauth_state');
      const storedAppId = localStorage.getItem('app_id');
      const storedAppSecret = localStorage.getItem('app_secret');

      if (state !== storedState) {
        setError('State mismatch - possible CSRF attack');
        return;
      }

      setAppId(storedAppId);
      setAppSecret(storedAppSecret);
      
      // Mark this code as being processed
      localStorage.setItem('processed_code', code);
      exchangeCodeForToken(code, storedAppId, storedAppSecret);
    }
  }, []);

  // Generate appsecret_proof for Facebook API calls
  const generateAppSecretProof = async (accessToken, appSecret) => {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(appSecret);
    const messageData = encoder.encode(accessToken);
    
    const cryptoKey = await crypto.subtle.importKey(
      'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    
    const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
    const hashArray = Array.from(new Uint8Array(signature));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };

  // Exchange authorization code for access token
  const exchangeCodeForToken = async (code, appId, appSecret) => {
    setLoading(true);
    try {
      // Using a CORS proxy for development - replace with your backend in production
      const proxyUrl = 'https://cors-anywhere.herokuapp.com/';
      const tokenUrl = `https://graph.facebook.com/v18.0/oauth/access_token?` +
        `client_id=${appId}&` +
        `redirect_uri=${encodeURIComponent(redirectUri)}&` +
        `client_secret=${appSecret}&` +
        `code=${code}`;

      const tokenResponse = await fetch(proxyUrl + tokenUrl, {
        method: 'GET',
        headers: {
          'X-Requested-With': 'XMLHttpRequest'
        }
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        throw new Error(`Token exchange failed: ${tokenResponse.status} - ${errorText}`);
      }

      const tokenData = await tokenResponse.json();
      setAccessToken(tokenData.access_token);
      
      // Store token and clear URL
      localStorage.setItem('access_token', tokenData.access_token);
      window.history.replaceState({}, document.title, window.location.pathname);
      
      // Fetch ad accounts
      await fetchAdAccounts(tokenData.access_token, appSecret);
      setStep('accounts');
    } catch (err) {
      setError(`Failed to exchange code for token: ${err.message}. Note: You may need to enable CORS proxy for development.`);
      setStep('credentials');
    } finally {
      setLoading(false);
    }
  };

  // Fetch user's ad accounts (personal, business, and sandbox)
  const fetchAdAccounts = async (token, appSecret) => {
    try {
      // Generate appsecret_proof
      const appSecretProof = await generateAppSecretProof(token, appSecret);
      
      const proxyUrl = 'https://cors-anywhere.herokuapp.com/';
      
      // Fetch personal ad accounts
      const personalAccountsUrl = `https://graph.facebook.com/v18.0/me/adaccounts?` +
        `fields=id,name,account_status,currency&` +
        `access_token=${token}&` +
        `appsecret_proof=${appSecretProof}`;
      
      const personalResponse = await fetch(proxyUrl + personalAccountsUrl, {
        method: 'GET',
        headers: {
          'X-Requested-With': 'XMLHttpRequest'
        }
      });

      if (!personalResponse.ok) {
        const errorText = await personalResponse.text();
        throw new Error(`Failed to fetch personal ad accounts: ${personalResponse.status} - ${errorText}`);
      }

      const personalData = await personalResponse.json();
      const personalAccounts = (personalData.data || []).map(account => ({
        ...account,
        source: account.account_status === 999 ? 'Sandbox Account' : 'Personal Account',
        business_name: account.account_status === 999 ? 'Sandbox Account' : 'Personal Account'
      }));

      // Fetch business accounts
      let businessAccounts = [];
      try {
        const businessesUrl = `https://graph.facebook.com/v18.0/me/businesses?` +
          `fields=id,name&` +
          `access_token=${token}&` +
          `appsecret_proof=${appSecretProof}`;
        
        const businessesResponse = await fetch(proxyUrl + businessesUrl, {
          method: 'GET',
          headers: {
            'X-Requested-With': 'XMLHttpRequest'
          }
        });

        if (businessesResponse.ok) {
          const businessesData = await businessesResponse.json();
          const businesses = businessesData.data || [];

          // For each business, fetch its ad accounts
          for (const business of businesses) {
            try {
              const businessAdAccountsUrl = `https://graph.facebook.com/v18.0/${business.id}/owned_ad_accounts?` +
                `fields=id,name,account_status,currency&` +
                `access_token=${token}&` +
                `appsecret_proof=${appSecretProof}`;
              
              const businessAdAccountsResponse = await fetch(proxyUrl + businessAdAccountsUrl, {
                method: 'GET',
                headers: {
                  'X-Requested-With': 'XMLHttpRequest'
                }
              });

              if (businessAdAccountsResponse.ok) {
                const businessAdAccountsData = await businessAdAccountsResponse.json();
                const accounts = (businessAdAccountsData.data || []).map(account => ({
                  ...account,
                  source: account.account_status === 999 ? 'Sandbox Account' : 'Business Portfolio',
                  business_name: account.account_status === 999 ? 'Sandbox Account' : business.name,
                  business_id: business.id
                }));
                businessAccounts.push(...accounts);
              }
            } catch (businessAccountError) {
              console.warn(`Could not fetch ad accounts for business ${business.name}:`, businessAccountError);
            }
          }
        }
      } catch (businessError) {
        console.warn('Could not fetch business accounts:', businessError);
      }

      // Combine and deduplicate accounts
      const allAccounts = [...personalAccounts, ...businessAccounts];
      const uniqueAccounts = allAccounts.filter((account, index, self) => 
        index === self.findIndex(a => a.id === account.id)
      );

      setAdAccounts(uniqueAccounts);
      
      // Store ad accounts for recovery
      localStorage.setItem('ad_accounts', JSON.stringify(uniqueAccounts));
    } catch (err) {
      setError(`Failed to fetch ad accounts: ${err.message}`);
    }
  };

  // Step 4: Generate .env file content OR go to extractor
  const selectAdAccount = (accountId) => {
    // Remove 'act_' prefix if it exists to store just the number
    const cleanAccountId = accountId.replace('act_', '');
    setSelectedAccountId(cleanAccountId);
    const envFileContent = `META_APP_ID=${appId}
META_APP_SECRET=${appSecret}
META_ACCESS_TOKEN=${accessToken}
META_AD_ACCOUNT_ID=${cleanAccountId}`;
    setEnvContent(envFileContent);
    setStep('complete');
  };

  // Go to campaign extractor
  const goToExtractor = (accountId) => {
    // Remove 'act_' prefix if it exists to store just the number
    const cleanAccountId = accountId.replace('act_', '');
    setSelectedAccountId(cleanAccountId);
    setStep('extractor');
  };

  // Download .env file
  const downloadEnvFile = () => {
    const blob = new Blob([envContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '.env';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Reset flow
  const resetFlow = () => {
    setStep('credentials');
    setAppId('');
    setAppSecret('');
    setAccessToken('');
    setAdAccounts([]);
    setSelectedAccountId('');
    setError('');
    setEnvContent('');
    localStorage.removeItem('oauth_state');
    localStorage.removeItem('app_id');
    localStorage.removeItem('app_secret');
    localStorage.removeItem('access_token');
    localStorage.removeItem('ad_accounts');
    localStorage.removeItem('processed_code');
    // Clear URL parameters
    window.history.replaceState({}, document.title, window.location.pathname);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-xl shadow-lg p-8">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              Facebook Ads API Setup
            </h1>
            <p className="text-gray-600">
              Authenticate with Facebook and get your API credentials
            </p>
            {/* Step 5: Campaign Data Extractor */}
          {step === 'extractor' && !loading && (
            <div className="space-y-6">
              <div className="text-center mb-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  Campaign Data Extractor
                </h3>
                <p className="text-gray-600">
                  Extract campaign data from your selected ad account
                </p>
              </div>

              <MetaCampaignExtractor 
                appId={appId}
                appSecret={appSecret}
                accessToken={accessToken}
                adAccountId={selectedAccountId}
              />

              <div className="text-center">
                <button
                  onClick={resetFlow}
                  className="bg-gray-600 text-white py-2 px-4 rounded-lg hover:bg-gray-700 transition-colors font-medium"
                >
                  Start Over
                </button>
              </div>
            </div>
          )}
        </div>

          {/* Progress Steps */}
          <div className="flex justify-between mb-8">
            <div className={`flex items-center ${step === 'credentials' ? 'text-blue-600' : step === 'oauth' || step === 'accounts' || step === 'complete' ? 'text-green-600' : 'text-gray-400'}`}>
              <Settings className="w-5 h-5 mr-2" />
              <span className="text-sm font-medium">Credentials</span>
            </div>
            <div className={`flex items-center ${step === 'oauth' ? 'text-blue-600' : step === 'accounts' || step === 'complete' ? 'text-green-600' : 'text-gray-400'}`}>
              <User className="w-5 h-5 mr-2" />
              <span className="text-sm font-medium">OAuth</span>
            </div>
            <div className={`flex items-center ${step === 'accounts' ? 'text-blue-600' : step === 'complete' ? 'text-green-600' : 'text-gray-400'}`}>
              <CreditCard className="w-5 h-5 mr-2" />
              <span className="text-sm font-medium">Ad Accounts</span>
            </div>
            <div className={`flex items-center ${step === 'complete' || step === 'extractor' ? 'text-green-600' : 'text-gray-400'}`}>
              <CheckCircle className="w-5 h-5 mr-2" />
              <span className="text-sm font-medium">Complete</span>
            </div>
            <div className={`flex items-center ${step === 'extractor' ? 'text-blue-600' : 'text-gray-400'}`}>
              <BarChart3 className="w-5 h-5 mr-2" />
              <span className="text-sm font-medium">Extract Data</span>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
              <div className="flex items-center">
                <AlertCircle className="w-5 h-5 text-red-500 mr-2" />
                <p className="text-red-700">{error}</p>
              </div>
            </div>
          )}

          {loading && (
            <div className="text-center py-8">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <p className="mt-2 text-gray-600">Processing...</p>
            </div>
          )}

          {/* Step 1: Credentials Input */}
          {step === 'credentials' && !loading && (
            <div className="space-y-6">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                <h3 className="font-semibold text-blue-900 mb-2">Before You Start:</h3>
                <ol className="text-blue-800 text-sm space-y-1 list-decimal list-inside">
                  <li>Create a Facebook App at developers.facebook.com</li>
                  <li>Add Facebook Login product to your app</li>
                  <li>Set OAuth redirect URI to: <code className="bg-blue-100 px-1 rounded">{redirectUri}</code></li>
                  <li>Get your App ID and App Secret from the app dashboard</li>
                  <li>For development: Visit <a href="https://cors-anywhere.herokuapp.com/corsdemo" target="_blank" rel="noopener noreferrer" className="underline">CORS Anywhere</a> and request temporary access</li>
                </ol>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Facebook App ID
                </label>
                <input
                  type="text"
                  value={appId}
                  onChange={(e) => setAppId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Enter your Facebook App ID"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Facebook App Secret
                </label>
                <input
                  type="password"
                  value={appSecret}
                  onChange={(e) => setAppSecret(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Enter your Facebook App Secret"
                />
              </div>

              <button
                onClick={handleCredentialsSubmit}
                className="w-full bg-blue-600 text-white py-3 px-4 rounded-lg hover:bg-blue-700 transition-colors font-medium"
              >
                Continue to OAuth
              </button>
            </div>
          )}

          {/* Step 2: OAuth Initiation */}
          {step === 'oauth' && !loading && (
            <div className="text-center space-y-6">
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <p className="text-green-800">
                  Ready to authenticate with Facebook. You'll be redirected to Facebook to grant permissions.
                </p>
              </div>
              
              <div className="space-y-2">
                <p className="text-sm text-gray-600">Required permissions:</p>
                <ul className="text-sm text-gray-500 space-y-1">
                  <li>• ads_management - Manage your ad accounts</li>
                  <li>• ads_read - Read your ads data</li>
                  <li>• business_management - Access business assets</li>
                </ul>
              </div>

              <button
                onClick={initiateOAuth}
                className="bg-blue-600 text-white py-3 px-6 rounded-lg hover:bg-blue-700 transition-colors font-medium"
              >
                Authenticate with Facebook
              </button>
            </div>
          )}

          {/* Step 3: Ad Account Selection */}
          {step === 'accounts' && !loading && (
            <div className="space-y-6">
              <div className="text-center">
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  Select Your Ad Account
                </h3>
                <p className="text-gray-600">
                  Choose the ad account you want to use for data extraction
                </p>
              </div>

              {adAccounts.length === 0 ? (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <p className="text-yellow-800">
                    No ad accounts found. Make sure your Facebook account has access to advertising accounts.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {adAccounts.map((account) => (
                    <div
                      key={account.id}
                      className="border border-gray-200 rounded-lg p-4 hover:border-blue-300 transition-colors"
                    >
                      <div className="flex justify-between items-center">
                        <div>
                          <h4 className="font-medium text-gray-900">{account.name}</h4>
                          <p className="text-sm text-gray-500">ID: {account.id}</p>
                          <p className="text-sm text-gray-500">
                            Status: {account.account_status} • Currency: {account.currency}
                          </p>
                          <div className="flex items-center mt-1">
                            <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                              account.source === 'Personal Account' 
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-purple-100 text-purple-800'
                            }`}>
                              {account.source}
                            </span>
                            {account.business_name && account.business_name !== 'Personal Account' && (
                              <span className="ml-2 text-xs text-gray-500">
                                {account.business_name}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex space-x-2">
                          <button
                            onClick={() => selectAdAccount(account.id)}
                            className="bg-green-600 text-white px-3 py-1 rounded text-sm hover:bg-green-700 transition-colors"
                          >
                            Download .env
                          </button>
                          <button
                            onClick={() => goToExtractor(account.id)}
                            className="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700 transition-colors"
                          >
                            Extract Data
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step 4: Complete */}
          {step === 'complete' && !loading && (
            <div className="space-y-6 text-center">
              <div className="bg-green-50 border border-green-200 rounded-lg p-6">
                <CheckCircle className="w-12 h-12 text-green-600 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-green-900 mb-2">
                  Setup Complete!
                </h3>
                <p className="text-green-700">
                  Your credentials have been generated successfully.
                </p>
              </div>

              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="font-medium text-gray-900 mb-2">Your .env file contents:</h4>
                <pre className="text-sm text-gray-600 bg-white p-3 rounded border overflow-x-auto">
                  {envContent}
                </pre>
              </div>

              <div className="space-y-3">
                <button
                  onClick={downloadEnvFile}
                  className="w-full bg-green-600 text-white py-3 px-4 rounded-lg hover:bg-green-700 transition-colors font-medium flex items-center justify-center"
                >
                  <Download className="w-5 h-5 mr-2" />
                  Download .env File
                </button>

                <button
                  onClick={resetFlow}
                  className="w-full bg-gray-600 text-white py-3 px-4 rounded-lg hover:bg-gray-700 transition-colors font-medium"
                >
                  Start Over
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Instructions */}
        <div className="mt-8 bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Next Steps:</h3>
          <ol className="space-y-2 text-gray-700 list-decimal list-inside">
            <li>Download the generated .env file</li>
            <li>Place it in the same directory as your Python script</li>
            <li>Run your Python ads data extraction script</li>
            <li>The script will automatically use these credentials</li>
          </ol>
        </div>
      </div>
    </div>
  );
};

export default FacebookOAuthApp;