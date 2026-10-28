import {AgentDefinition} from "@anthropic-ai/claude-agent-sdk";
import {TEST_COVERAGE_ANALYZER_PROMPT} from "../prompts/test-coverage-analyzer.prompt";

export const testCoverageAnalyzer: AgentDefinition = {
    description:
        `Analyzes source code and existing tests to find coverage gaps. Use proactively after writing 
        or modifying code, before merging a PR, or when asked to review test quality. Identifies functions 
        and methods with no or weak test coverage, suggests specific test cases with meaningful assertions, 
        estimates coverage percentage, and prioritizes critical untested paths (security, payments, 
        data integrity, error handling) by risk.`,
    prompt: TEST_COVERAGE_ANALYZER_PROMPT,
    model: 'inherit',
    tools: ['Read', 'Grep', 'Glob', 'Bash', 'Skill']
}