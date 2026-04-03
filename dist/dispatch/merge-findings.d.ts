import type { Finding } from '../types.js';
interface ProviderFindings {
    provider: string;
    findings: Finding[];
}
interface MergedFinding extends Finding {
    agreedBy: string[];
}
export declare function mergeFindings(providerResults: ProviderFindings[]): MergedFinding[];
export {};
//# sourceMappingURL=merge-findings.d.ts.map