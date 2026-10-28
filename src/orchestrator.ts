import 'dotenv/config';
import {ReviewReport, ReviewReportSchema} from './types/report-types';
import {AgentDefinition, query} from '@anthropic-ai/claude-agent-sdk';
import {ORCHESTRATOR_PROMPT} from "./prompts";
import {codeQualityAnalyzer, refactoringSuggester, testCoverageAnalyzer} from "./agents";
import {zodToJsonSchema} from "zod-to-json-schema";
import {mcpServersConfig} from "./config/mcp.config";
import * as dotenv from "dotenv";

dotenv.config();

const subagents: Record<string, AgentDefinition> = {
    quality: codeQualityAnalyzer,
    coverage: testCoverageAnalyzer,
    refactoring: refactoringSuggester,
}

/**
 * Orchestrator configuration options
 */
export interface OrchestratorOptions {
}

/**
 * Main Code Review Orchestrator
 * Coordinates subagents to analyze pull requests and generate comprehensive reports
 */
export class CodeReviewOrchestrator {


  constructor(options: OrchestratorOptions = {}) {
  }

  /**
   * Review a pull request using parallel subagent analysis
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param prNumber - Pull request number
   * @returns Complete review report
   */
  async reviewPullRequest(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<ReviewReport> {
      try {
          for await (const message of query({
              prompt: `${ORCHESTRATOR_PROMPT}
              
              # Input
              Review this pull request now: ${owner}/${repo}#${prNumber}
                
              - owner: ${owner}
              - repo: ${repo}
              - number: ${prNumber}
                
              All required input is provided. Do not ask the user for anything; fetch the PR data and produce the report.
              `
              ,
              options: {
                  allowedTools: [
                      "Task",
                      "mcp__eslint",
                      "mcp__github__get_pull_request",
                      "mcp__github__get_pull_request_files",
                      "mcp__github__get_file_contents",
                  ],
                  agents: subagents,
                  model: process.env.ANTHROPIC_MODEL,
                  maxTurns: 15,
                  outputFormat: {
                      type: 'json_schema',
                      schema: zodToJsonSchema(ReviewReportSchema, {$refStrategy: "root"})
                  },
                  mcpServers: mcpServersConfig
              },
          })) {
              if (message.type === 'system' && message.subtype === 'init') {
                  console.log("Available MCP tools:", message.mcp_servers);
              }

              if (message.type === 'result') {
                  console.log('RESULT:', JSON.stringify(message, null, 2));
                  if (message.subtype !== 'success') {
                      throw new Error(`Query ended with: ${message.subtype}`);
                  }
                  if (message.structured_output) {
                      return ReviewReportSchema.parse(message.structured_output)
                  }
              }
          }
      } catch (error) {
          console.log('error')
          throw error;
      }

      throw new Error('rorre');
  }
}
