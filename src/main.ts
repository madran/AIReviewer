import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import {CodeReviewOrchestrator} from "./orchestrator";
import {ReportGenerator} from "./utils";

dotenv.config();

/**
 * Main entry point for the Claude Multi-Agent Code Review System
 * Usage: npm run dev <owner> <repo> <pr-number>
 */
async function main() {
    const [owner, repo, prStr] = process.argv.slice(2);

    if (!owner || !repo || !prStr) {
        console.error('Missing arguments.');
        console.error('Usage: npm run dev <owner> <repo> <pr-number>');
        process.exit(1);
    }

    if (!/^\d+$/.test(prStr) || Number(prStr) < 1) {
        console.error(`Invalid PR number "${prStr}". It must be a positive integer.`);
        process.exit(1);
    }
    const prNumber = parseInt(prStr, 10);

    const hasBedrockCreds =
        !!process.env.AWS_ACCESS_KEY_ID && !!process.env.AWS_SECRET_ACCESS_KEY;
    const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;

    if (hasBedrockCreds) {
        if (!process.env.AWS_REGION) {
            console.error('AWS_REGION must be set when using AWS Bedrock.');
            process.exit(1);
        }
        console.log('Using AWS Bedrock authentication');
    } else if (hasAnthropicKey) {
        console.log('Using Anthropic API authentication');
    } else {
        console.error('No authentication configured.')
        process.exit(1);
    }

    if (!process.env.ANTHROPIC_MODEL) {
        console.error('ANTHROPIC_MODEL is not set.');
        process.exit(1);
    }

    console.log(`Reviewing ${owner}/${repo}#${prNumber} with ${process.env.ANTHROPIC_MODEL}`);

    try {
        const orchestrator = new CodeReviewOrchestrator();
        const result = await orchestrator.reviewPullRequest(owner, repo, prNumber);

        const reportGenerator = new ReportGenerator();
        const reportsDir = path.resolve('reports');
        fs.mkdirSync(reportsDir, { recursive: true });

        const baseName = `${owner}-${repo}-pr-${prNumber}`;
        const markdownPath = path.join(reportsDir, `${baseName}.md`);
        const htmlPath = path.join(reportsDir, `${baseName}.html`);
        const jsonPath = path.join(reportsDir, `${baseName}.json`);

        fs.writeFileSync(markdownPath, reportGenerator.generateMarkdownReport(result), 'utf-8');
        fs.writeFileSync(htmlPath, reportGenerator.generateHTMLReport(result), 'utf-8');
        fs.writeFileSync(jsonPath, reportGenerator.generateJSONReport(result), 'utf-8');

        console.log('Review complete. Reports saved:');
        console.log(`   ${markdownPath}`);
        console.log(`   ${htmlPath}`);
        console.log(`   ${jsonPath}`);
    } catch (error) {
        console.error('Error during code review:', error instanceof Error ? error.message : error);
        process.exit(1);
    }
}

main();
