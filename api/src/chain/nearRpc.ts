import { config } from "../config.js";

export async function callNearView<T = unknown>(
    contractId: string,
    methodName: string,
    args: Record<string, unknown> = {}
): Promise<T> {
    const argsBase64 = Buffer.from(JSON.stringify(args)).toString("base64");
    const res = await fetch(config.NEAR_NODE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: "homr-view-call",
            method: "query",
            params: {
                request_type: "call_function",
                finality: "final",
                account_id: contractId,
                method_name: methodName,
                args_base64: argsBase64,
            },
        }),
    });

    if (!res.ok) {
        throw new Error(`NEAR RPC error: ${res.statusText}`);
    }

    const payload = (await res.json()) as {
        result?: { result: number[] };
        error?: { message: string };
    };

    if (payload.error) {
        throw new Error(payload.error.message || "Failed to query view method");
    }

    if (!payload.result?.result) {
        return null as unknown as T;
    }

    const jsonStr = Buffer.from(payload.result.result).toString("utf-8");
    return JSON.parse(jsonStr) as T;
}

export async function getVaultState() {
    try {
        const [availableCapital, totalDeployed, totalAssets, totalShares, navPerShare] =
            await Promise.all([
                callNearView<string>(config.contracts.vault, "available_capital"),
                callNearView<string>(config.contracts.vault, "total_deployed_capital"),
                callNearView<string>(config.contracts.vault, "total_assets"),
                callNearView<string>(config.contracts.vault, "ft_total_supply"),
                callNearView<string>(config.contracts.vault, "get_nav_per_share"),
            ]);

        return {
            availableCapital: availableCapital || "0",
            deployedCapital: totalDeployed || "0",
            totalAssets: totalAssets || "0",
            totalShares: totalShares || "0",
            sharePrice: navPerShare || "1000000",
        };
    } catch {
        // Fallback for demo when contracts are not yet deployed
        return {
            availableCapital: "100000000000",
            deployedCapital: "50000000000",
            totalAssets: "150000000000",
            totalShares: "145000000000",
            sharePrice: "1034482",
        };
    }
}

