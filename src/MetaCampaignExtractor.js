import React, { useState } from 'react';
import { Download, AlertCircle, RefreshCw, Eye, Calendar } from 'lucide-react';

const MetaCampaignExtractor = ({ appId, appSecret, accessToken, adAccountId }) => {
  const [campaignData, setCampaignData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [datePreset, setDatePreset] = useState('last_30d');

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

  // Make Facebook Graph API call
  const makeGraphAPICall = async (endpoint, params = {}) => {
    const appSecretProof = await generateAppSecretProof(accessToken, appSecret);
    
    const queryParams = new URLSearchParams({
      access_token: accessToken,
      appsecret_proof: appSecretProof,
      ...params
    });

    const proxyUrl = 'https://cors-anywhere.herokuapp.com/';
    const apiUrl = `https://graph.facebook.com/v18.0/${endpoint}?${queryParams}`;
    
    const response = await fetch(proxyUrl + apiUrl, {
      method: 'GET',
      headers: {
        'X-Requested-With': 'XMLHttpRequest'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API call failed: ${response.status} - ${errorText}`);
    }

    return await response.json();
  };

  // Parse Facebook actions data
  const parseActions = (actions) => {
    if (!actions || !Array.isArray(actions)) return {};
    
    const parsed = {};
    actions.forEach(action => {
      const actionType = action.action_type || 'unknown';
      const value = action.value || 0;
      parsed[actionType] = parseFloat(value) || 0;
    });
    return parsed;
  };

  // Extract campaign data (mirroring Python function)
  const extractCampaignData = async () => {
    setLoading(true);
    setError('');
    
    try {
      console.log('Extracting campaign data...');
      
      // Ensure adAccountId is just the number (remove act_ if present)
      const cleanAdAccountId = adAccountId.replace('act_', '');
      
      // Step 1: Get basic campaign info
      const campaignsResponse = await makeGraphAPICall(
        `act_${cleanAdAccountId}/campaigns`,
        {
          fields: [
            'id',
            'name', 
            'objective',
            'status',
            'created_time',
            'updated_time',
            'start_time',
            'stop_time',
            'daily_budget',
            'lifetime_budget',
            'budget_remaining'
          ].join(',')
        }
      );

      const campaigns = campaignsResponse.data || [];
      console.log(`Found ${campaigns.length} campaigns`);

      // Step 2: Process basic campaign data
      const campaignData = campaigns.map(campaign => ({
        ...campaign,
        campaign_id: campaign.id,
        campaign_name: campaign.name,
        account_id: `act_${cleanAdAccountId}`,
        extracted_at: new Date().toISOString(),
        date_preset: datePreset,
        // Initialize metrics as 0 (will be populated if insights exist)
        impressions: 0,
        reach: 0,
        clicks: 0,
        cpc: 0,
        cpm: 0,
        ctr: 0,
        spend: 0,
        cost_per_conversion: 0,
        parsed_actions: {}
      }));

      // Step 3: Try to get insights for campaigns that have run
      if (campaigns.length > 0) {
        try {
          console.log('Fetching campaign insights...');
          const insightsResponse = await makeGraphAPICall(
            `act_${cleanAdAccountId}/insights`,
            {
              fields: [
                'campaign_id',
                'impressions',
                'reach', 
                'clicks',
                'cpc',
                'cpm',
                'ctr',
                'spend',
                'actions'
              ].join(','),
              date_preset: datePreset,
              level: 'campaign',
              limit: '1000'
            }
          );

          const insights = insightsResponse.data || [];
          console.log(`Found insights for ${insights.length} campaigns`);

          // Step 4: Merge insights with campaign data
          const insightsDict = {};
          insights.forEach(insight => {
            const campaignId = insight.campaign_id;
            if (campaignId) {
              insightsDict[campaignId] = insight;
            }
          });

          // Update campaign data with insights
          campaignData.forEach(campaign => {
            const campaignId = campaign.id;
            if (insightsDict[campaignId]) {
              const insight = insightsDict[campaignId];
              
              // Update metrics
              campaign.impressions = parseInt(insight.impressions || 0);
              campaign.reach = parseInt(insight.reach || 0);
              campaign.clicks = parseInt(insight.clicks || 0);
              campaign.cpc = parseFloat(insight.cpc || 0);
              campaign.cpm = parseFloat(insight.cpm || 0);
              campaign.ctr = parseFloat(insight.ctr || 0);
              campaign.spend = parseFloat(insight.spend || 0);

              // Parse actions if present
              if (insight.actions) {
                campaign.parsed_actions = parseActions(insight.actions);
              }
            }
          });

        } catch (insightError) {
          console.warn('Could not fetch insights (normal for paused/new campaigns):', insightError.message);
        }
      }

      setCampaignData(campaignData);
      console.log(`Extracted ${campaignData.length} campaign records`);
      
    } catch (err) {
      console.error('Error extracting campaign data:', err);
      setError(`Failed to extract campaign data: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Download data as CSV
  const downloadCSV = () => {
    if (campaignData.length === 0) return;

    // Create CSV content
    const headers = Object.keys(campaignData[0]).filter(key => key !== 'parsed_actions');
    const csvContent = [
      headers.join(','),
      ...campaignData.map(row => 
        headers.map(header => {
          const value = row[header];
          // Handle strings that might contain commas
          if (typeof value === 'string' && value.includes(',')) {
            return `"${value}"`;
          }
          return value || '';
        }).join(',')
      )
    ].join('\n');

    // Download file
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `campaign_data_${datePreset}_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Format currency values
  const formatCurrency = (value) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2
    }).format(value || 0);
  };

  // Format percentage values
  const formatPercentage = (value) => {
    return `${(value || 0).toFixed(2)}%`;
  };

  // Format large numbers
  const formatNumber = (value) => {
    return new Intl.NumberFormat('en-US').format(value || 0);
  };

  return (
    <div className="bg-white rounded-xl shadow-lg p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Campaign Data Extractor</h2>
          <p className="text-gray-600">Extract and view Facebook campaign performance data</p>
        </div>
        
        <div className="flex items-center space-x-4">
          {/* Date Preset Selector */}
          <div className="flex items-center space-x-2">
            <Calendar className="w-4 h-4 text-gray-500" />
            <select
              value={datePreset}
              onChange={(e) => setDatePreset(e.target.value)}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="last_3d">Last 3 Days</option>
              <option value="this_week">This Week</option>
              <option value="last_week">Last Week</option>
              <option value="last_7d">Last 7 Days</option>
              <option value="last_14d">Last 14 Days</option>
              <option value="last_30d">Last 30 Days</option>
              <option value="this_month">This Month</option>
              <option value="last_month">Last Month</option>
              <option value="last_90d">Last 90 Days</option>
            </select>
          </div>

          <button
            onClick={extractCampaignData}
            disabled={loading}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center disabled:opacity-50"
          >
            {loading ? (
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Eye className="w-4 h-4 mr-2" />
            )}
            {loading ? 'Extracting...' : 'Extract Data'}
          </button>

          {campaignData.length > 0 && (
            <button
              onClick={downloadCSV}
              className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors font-medium flex items-center"
            >
              <Download className="w-4 h-4 mr-2" />
              Download CSV
            </button>
          )}
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

      {/* Campaign Data Table */}
      {campaignData.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Campaign
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Objective
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Spend
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Impressions
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Clicks
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  CTR
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  CPC
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  CPM
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {campaignData.map((campaign, index) => (
                <tr key={campaign.id} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900">{campaign.name}</div>
                    <div className="text-sm text-gray-500">{campaign.id}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                      campaign.status === 'ACTIVE' 
                        ? 'bg-green-100 text-green-800'
                        : campaign.status === 'PAUSED'
                        ? 'bg-yellow-100 text-yellow-800'
                        : 'bg-red-100 text-red-800'
                    }`}>
                      {campaign.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {campaign.objective || 'N/A'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-medium">
                    {formatCurrency(campaign.spend)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {formatNumber(campaign.impressions)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {formatNumber(campaign.clicks)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {formatPercentage(campaign.ctr)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {formatCurrency(campaign.cpc)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {formatCurrency(campaign.cpm)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {campaignData.length === 0 && !loading && (
        <div className="text-center py-12">
          <Eye className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No Campaign Data</h3>
          <p className="text-gray-500">Click "Extract Data" to fetch campaign information from Facebook.</p>
        </div>
      )}

      {/* Summary Stats */}
      {campaignData.length > 0 && (
        <div className="mt-6 grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-blue-50 p-4 rounded-lg">
            <div className="text-sm font-medium text-blue-600">Total Campaigns</div>
            <div className="text-2xl font-bold text-blue-900">{campaignData.length}</div>
          </div>
          <div className="bg-green-50 p-4 rounded-lg">
            <div className="text-sm font-medium text-green-600">Total Spend</div>
            <div className="text-2xl font-bold text-green-900">
              {formatCurrency(campaignData.reduce((sum, campaign) => sum + (campaign.spend || 0), 0))}
            </div>
          </div>
          <div className="bg-purple-50 p-4 rounded-lg">
            <div className="text-sm font-medium text-purple-600">Total Impressions</div>
            <div className="text-2xl font-bold text-purple-900">
              {formatNumber(campaignData.reduce((sum, campaign) => sum + (campaign.impressions || 0), 0))}
            </div>
          </div>
          <div className="bg-orange-50 p-4 rounded-lg">
            <div className="text-sm font-medium text-orange-600">Total Clicks</div>
            <div className="text-2xl font-bold text-orange-900">
              {formatNumber(campaignData.reduce((sum, campaign) => sum + (campaign.clicks || 0), 0))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MetaCampaignExtractor;