export const NEAR_CONFIG = {
  networkId: import.meta.env.VITE_NEAR_NETWORK_ID || 'testnet',
  rpcUrl: import.meta.env.VITE_NEAR_RPC_URL || 'https://archival-rpc.testnet.near.org',
  nodeUrl: import.meta.env.VITE_NEAR_NODE_URL || 'https://rpc.testnet.near.org',
  contractId: import.meta.env.VITE_NEAR_CONTRACT_ID || import.meta.env.VITE_AUDIT_CONTRACT || 'audit.homr.testnet',
  vaultContractId: import.meta.env.VITE_VAULT_CONTRACT || 'vault.homr.testnet',
  auctionContractId: import.meta.env.VITE_AUCTION_CONTRACT || 'auction.homr.testnet',
  loanManagerContractId: import.meta.env.VITE_LOAN_MANAGER_CONTRACT || 'loan-manager.homr.testnet',
  auditContractId: import.meta.env.VITE_AUDIT_CONTRACT || 'audit.homr.testnet',
  tokenContractId: import.meta.env.VITE_TOKEN_CONTRACT || 'token.homr.testnet',
  explorerUrl: import.meta.env.VITE_NEAR_EXPLORER_URL || 'https://testnet.nearblocks.io',
};

export const CHAIN_CONFIG = {
  chainId: 'near:testnet',
  chainName: 'NEAR Protocol Testnet',
  rpcUrl: NEAR_CONFIG.rpcUrl,
  blockExplorer: NEAR_CONFIG.explorerUrl,
  currencySymbol: 'NEAR',
};

export const CONTRACT_ADDRESSES = {
  MockUSDC: NEAR_CONFIG.tokenContractId,
  HousingCreditVault: NEAR_CONFIG.vaultContractId,
  LoanManager: NEAR_CONFIG.loanManagerContractId,
  CreditAuction: NEAR_CONFIG.auctionContractId,
  AuditRegistry: NEAR_CONFIG.auditContractId,
};
