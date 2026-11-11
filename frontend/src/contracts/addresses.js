export const NEAR_CONFIG = {
  networkId: 'testnet',

  // PASTIKAN MENGGUNAKAN URL INI (FastNEAR)
  rpcUrl: 'https://test.rpc.fastnear.com',
  nodeUrl: 'https://test.rpc.fastnear.com',

  contractId: 'audit.funnylace8065.testnet',
  vaultContractId: 'housing-vault.funnylace8065.testnet',
  auctionContractId: 'credit-auction.funnylace8065.testnet',
  loanManagerContractId: 'loan-manager.funnylace8065.testnet',
  auditContractId: 'audit.funnylace8065.testnet',
  tokenContractId: 'mock-token.funnylace8065.testnet',
  explorerUrl: 'https://testnet.nearblocks.io',
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
