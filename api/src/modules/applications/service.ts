import { prisma } from "../../db/client.js";
import { approveBorrower } from "../../chain/nearSigner.js";

export interface CreateApplicationInput {
    walletAddress?: string;    // Accepted for backwards compat
    accountId?: string;        // NEAR accountId
    displayName: string;
    propertyHash: string;
    requestedAmount: string;   // bigint string
    requestedRate: number;     // basis points
    requestedTerm: number;     // detik / hari
}

export async function createApplication(input: CreateApplicationInput) {
    const account = (input.accountId || input.walletAddress || "borrower.testnet").toLowerCase();

    // Upsert applicant
    const applicant = await prisma.applicant.upsert({
        where: { accountId: account },
        create: {
            accountId: account,
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

    if (!input.maxPrincipal) {
        throw new Error("MAX_PRINCIPAL_REQUIRED");
    }

    const tx = await approveBorrower(
        application.applicant.accountId,
        BigInt(input.maxPrincipal),
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
        include: { applicant: true },
    });

    return {
        ...updated,
        approvalTxHash: tx.txHash,
    };
}
