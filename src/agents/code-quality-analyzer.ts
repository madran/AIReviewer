import {AgentDefinition} from "@anthropic-ai/claude-agent-sdk";
import {CODE_QUALITY_ANALYZER_PROMPT} from "../prompts/code-quality-analyzer.prompt";

export const codeQualityAnalyzer: AgentDefinition = {
    description:
        `Use this agent to review code for quality before merging or after writing significant changes. 
        It checks for security vulnerabilities, performance bottlenecks, and best-practice or maintainability 
        issues, and returns severity-ranked findings with actionable fixes. Use proactively after implementing 
        features, refactoring, or modifying authentication, database, or API code.`,
    prompt: CODE_QUALITY_ANALYZER_PROMPT,
    model: 'inherit',
    tools: ['Read', 'Grep', 'Glob', 'Bash', 'Skill'],
}