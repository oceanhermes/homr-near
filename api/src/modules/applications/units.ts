// Application amounts retain six decimal places in the existing database/API.
export function applicationAmountToToken(amount: bigint, tokenDecimals: number): bigint {
    if (amount <= 0n) throw new Error('MAX_PRINCIPAL_MUST_BE_POSITIVE');
    if (tokenDecimals >= 6) return amount * 10n ** BigInt(tokenDecimals - 6);
    const divisor = 10n ** BigInt(6 - tokenDecimals);
    if (amount % divisor !== 0n) throw new Error('AMOUNT_EXCEEDS_TOKEN_PRECISION');
    return amount / divisor;
}
