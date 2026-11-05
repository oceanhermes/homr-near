// Contract addresses with environment variable overrides and placeholders
export const CONTRACT_ADDRESSES = {
  MockUSDC: import.meta.env.VITE_MOCK_USDC_ADDRESS || '0x68F7aAbB357cEF15F8245468f4b66619Bbba051a',
  HousingCreditVault: import.meta.env.VITE_VAULT_ADDRESS || '0xDab816f3B857084e2dA394e4ef142FF680671525',
  LoanManager: import.meta.env.VITE_LOAN_MANAGER_ADDRESS || '0xDb2aceAd65bF79bf304d97979ea14cbc4e74dfab',
  CreditAuction: import.meta.env.VITE_CREDIT_AUCTION_ADDRESS || '0x99123ADC1dc2594b94ca02A65F553E5c1d0fC4c5'
};

const NETWORK_PRESETS = {
  bnbTestnet: {
    chainId: 97,
    chainName: 'BNB Smart Chain Testnet',
    rpcUrl: 'https://bsc-testnet-rpc.publicnode.com',
    blockExplorer: 'https://testnet.bscscan.com',
    currencySymbol: 'tBNB',
  },
  auroraTestnet: {
    chainId: 1313161555,
    chainName: 'Aurora Testnet',
    rpcUrl: 'https://testnet.aurora.dev',
    blockExplorer: 'https://testnet.aurorascan.dev',
    currencySymbol: 'ETH',
  },
};

const requestedNetwork = import.meta.env.VITE_NETWORK || 'bnbTestnet';
const requestedChainId = Number(import.meta.env.VITE_CHAIN_ID || NETWORK_PRESETS[requestedNetwork]?.chainId || 97);
const networkPreset = Object.values(NETWORK_PRESETS).find(({ chainId }) => chainId === requestedChainId) || NETWORK_PRESETS[requestedNetwork] || NETWORK_PRESETS.bnbTestnet;
const configuredChainId = requestedChainId;

export const CHAIN_CONFIG = {
  chainId: configuredChainId,
  chainName: configuredChainId === 31337 ? 'Local development' : networkPreset.chainName,
  rpcUrl: import.meta.env.VITE_RPC_URL || (configuredChainId === 31337 ? 'http://127.0.0.1:8545' : networkPreset.rpcUrl),
  blockExplorer: import.meta.env.VITE_EXPLORER_URL || (configuredChainId === 31337 ? '' : networkPreset.blockExplorer),
  currencySymbol: networkPreset.currencySymbol,
};

export const SUPPORTED_NETWORKS = NETWORK_PRESETS;

export const NEAR_CONFIG = {
  networkId: import.meta.env.VITE_NEAR_NETWORK_ID || 'testnet',
  rpcUrl: import.meta.env.VITE_NEAR_RPC_URL || 'https://archival-rpc.testnet.near.org',
  contractId: import.meta.env.VITE_NEAR_CONTRACT_ID || '',
  explorerUrl: 'https://testnet.nearblocks.io',
};
