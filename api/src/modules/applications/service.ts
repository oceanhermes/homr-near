import { prisma } from "../../db/client.js";
import { approveBorrower } from "../../chain/signer.js";
import { publicClient, abis } from "../../chain/contracts.js";
import { config } from "../../config.js";
import { applicationAmountToToken } from "./units.js";

export interface CreateApplicationInput {
    walletAddress: string;
    displayName: string;
    propertyHash: string;
    requestedAmount: string;   // bigint string
    requestedRate: number;     // basis points
    requestedTerm: number;     // detik
}

export async function createApplication(input: CreateApplicationInput) {
    // Upsert applicant
    const applicant = await prisma.applicant.upsert({
        where: { walletAddress: input.walletAddress.toLowerCase() },
        create: {
            walletAddress: input.walletAddress.toLowerCase(),
            displayName: input.displayName,
            kycStatus: "DEMO",
        },
        update: {
            displayName: input.displayName,
        },
    });

    const application = await prisma.application.create({
        data: {
            applicantId: applicant.id,
            propertyHash: input.propertyHash,
            requestedAmount: BigInt(input.requestedAmount),
            requestedRate: input.requestedRate,
            requestedTerm: input.requestedTerm,
            status: "PENDING",
        },
    });

    return application;
}

export async function listApplications() {
    return prisma.application.findMany({
        orderBy: { createdAt: "desc" },
        include: { applicant: true },
    });
}

export async function getApplication(id: string) {
    return prisma.application.findUnique({
        where: { id },
        include: { applicant: true },
    });
}

export interface ReviewInput {
    decision: "APPROVED" | "REJECTED";
    maxPrincipal?: string;    // bigint string — wajib kalau APPROVED
    reviewedBy: string;
    reviewNote?: string;
}

export async function reviewApplication(id: string, input: ReviewInput) {
    const application = await prisma.application.findUnique({
        where: { id },
        include: { applicant: true },
    });

    if (!application) {
        throw new Error("APPLICATION_NOT_FOUND");
    }
    if (application.status !== "PENDING") {
        throw new Error("APPLICATION_ALREADY_REVIEWED");
    }

    // REJECTED → simpan saja, tidak panggil kontrak
    if (input.decision === "REJECTED") {
        return prisma.application.update({
            where: { id },
            data: {
                status: "REJECTED",
                reviewedBy: input.reviewedBy,
                reviewedAt: new Date(),
                reviewNote: input.reviewNote,
            },
        });
    }

    // APPROVED → panggil kontrak approveBorrower
    if (!input.maxPrincipal) {
        throw new Error("MAX_PRINCIPAL_REQUIRED");
    }

    const tokenDecimals = await publicClient.readContract({
        address: config.addresses.mockUsdc,
        abi: abis.mockUsdc,
        functionName: "decimals",
    }) as number;

    const tx = await approveBorrower(
        application.applicant.walletAddress as `0x${string}`,
        applicationAmountToToken(BigInt(input.maxPrincipal), tokenDecimals),
        application.propertyHash
    );

    const updated = await prisma.application.update({
        where: { id },
        data: {
            status: "APPROVED",
            maxPrincipal: BigInt(input.maxPrincipal),
            reviewedBy: input.reviewedBy,
            reviewedAt: new Date(),
            reviewNote: input.reviewNote,
            approvalTxHash: tx.txHash,
        },
        select: {
            id: true,
            applicantId: true,
            propertyHash: true,
            requestedAmount: true,
            requestedRate: true,
            requestedTerm: true,
            status: true,
            maxPrincipal: true,
            reviewedBy: true,
            reviewedAt: true,
            reviewNote: true,
            approvalTxHash: true,
            createdAt: true,
        },
    });

    return {
        ...updated,
        approvalTxHash: tx.txHash,
    };
}