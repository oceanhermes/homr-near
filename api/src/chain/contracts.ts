import {
    createPublicClient,
    createWalletClient,
    http,
    parseAbi,
    type PublicClient,
    type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "../config.js";

const configuredChain = {
    id: config.CHAIN_ID,
    name: config.NETWORK_NAME,
    nativeCurrency: { name: config.NATIVE_CURRENCY_NAME, symbol: config.NATIVE_CURRENCY_SYMBOL, decimals: 18 },
    rpcUrls: { default: { http: [config.RPC_URL] } },
    blockExplorers: { default: { name: config.EXPLORER_NAME, url: config.EXPLORER_URL } },
} as const;

export const publicClient: PublicClient = createPublicClient({
    chain: configuredChain,
    transport: http(config.RPC_URL),
});

const account = privateKeyToAccount(config.ADMIN_PRIVATE_KEY as `0x${string}`);
export const walletClient: WalletClient = createWalletClient({
    account,
    chain: configuredChain,
    transport: http(config.RPC_URL),
});

export const abis = {
    vault: parseAbi([
        "function asset() view returns (address)",
        "function availableCapital() view returns (uint256)",
        "function totalDeployedCapital() view returns (uint256)",
        "function totalSupply() view returns (uint256)",
        "function balanceOf(address) view returns (uint256)",
        "function deposit(uint256 assets)",
        "function withdraw(uint256 shares)",
        "event Deposit(address indexed investor, uint256 assets, uint256 shares)",
        "event Withdraw(address indexed investor, uint256 assets, uint256 shares)",
        "event CapitalDeployed(uint256 amount)",
        "event RepaymentReceived(uint256 amount)",
    ]),

    auction: parseAbi([
        "function approveBorrower(address borrower, uint256 maxPrincipal, string propertyHash)",
        "function startAuction(uint256 _commitDuration, uint256 _revealDuration)",
        "function commitBid(bytes32 commitment)",
        "function revealBid(uint256 amount, uint256 rate, uint256 term, string salt)",
        "function finalizeAuction()",
        "function commitDeadline() view returns (uint256)",
        "function revealDeadline() view returns (uint256)",
        "function state() view returns (uint8)",
        "function CREDIT_MANAGER_ROLE() view returns (bytes32)",
        "function AUCTION_MANAGER_ROLE() view returns (bytes32)",
        "function LOAN_MANAGER_ROLE() view returns (bytes32)",
        "function hasRole(bytes32 role, address account) view returns (bool)",
        "event BorrowerApproved(address indexed borrower, uint256 maxPrincipal, string propertyHash)",
        "event AuctionStarted(uint256 commitDeadline, uint256 revealDeadline)",
        "event BidCommitted(address indexed borrower, bytes32 commitment)",
        "event BidRevealed(address indexed borrower, uint256 amount, uint256 rate, uint256 term)",
        "event AuctionFinalized()",
    ]),

    loanManager: parseAbi([
        "function nextLoanId() view returns (uint256)",
        "function loans(uint256) view returns (address borrower, uint256 principal, uint256 rate, uint256 term, string propertyHash, bool isActive)",
        "event LoanCreated(uint256 indexed loanId, address indexed borrower, uint256 principal, uint256 rate)",
        "event LoanRepaid(uint256 indexed loanId, uint256 amount)",
    ]),

    mockUsdc: parseAbi([
        "function decimals() view returns (uint8)",
        "function mint(address to, uint256 amount)",
        "function balanceOf(address) view returns (uint256)",
        "event Transfer(address indexed from, address indexed to, uint256 value)",
    ]),
};

/**
 * Baca state vault via multicall.
 *
 * viem bisa mengembalikan hasil dengan tipe yang tidak seragam (bigint | number | undefined).
 * Kita normalisasi semua ke bigint secara eksplisit supaya operasi aritmetika aman.
 */
export async function getVaultState() {
    const results = await publicClient.multicall({
        contracts: [
            { address: config.addresses.vault, abi: abis.vault, functionName: "availableCapital" },
            { address: config.addresses.vault, abi: abis.vault, functionName: "totalDeployedCapital" },
            { address: config.addresses.vault, abi: abis.vault, functionName: "totalSupply" },
        ],
    });

    const available = toBigIntSafe(results[0]?.result);
    const deployed = toBigIntSafe(results[1]?.result);
    const totalSupply = toBigIntSafe(results[2]?.result);

    const totalAssets = available + deployed;
    const sharePrice =
        totalSupply === 0n
            ? 1_000_000n
            : (totalAssets * 1_000_000n) / totalSupply;

    return {
        availableCapital: available.toString(),
        deployedCapital: deployed.toString(),
        totalAssets: totalAssets.toString(),
        totalShares: totalSupply.toString(),
        sharePrice: sharePrice.toString(),
    };
}

/**
 * Konversi nilai apapun (bigint, number, string, undefined) menjadi bigint dengan aman.
 * Dipakai untuk menormalkan hasil multicall dari viem.
 */
function toBigIntSafe(value: unknown): bigint {
    if (value === null || value === undefined) return 0n;
    if (typeof value === "bigint") return value;
    if (typeof value === "number") return BigInt(Math.trunc(value));
    if (typeof value === "string") {
        try {
            return BigInt(value);
        } catch {
            return 0n;
        }
    }
    return 0n;
}

export { account as adminAccount };
