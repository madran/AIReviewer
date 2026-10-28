import {AgentDefinition} from "@anthropic-ai/claude-agent-sdk";
import {REFACTORING_SUGGESTER_PROMPT} from "../prompts/refactoring-suggester.prompt";

export const refactoringSuggester: AgentDefinition = {
    description:
        `Reviews source code and suggests behavior-preserving refactorings. Use proactively after writing 
        or modifying code, before a PR, or when the user asks about code quality, cleanup, or maintainability. 
        Identifies opportunities to apply design patterns and modern language features, 
        proposes extract method/class candidates, and finds dead code and redundant logic. 
        Read-only: it analyzes and recommends but never edits files.`,
    prompt: REFACTORING_SUGGESTER_PROMPT,
    model: 'inherit',
    tools: ['Read', 'Grep', 'Glob', 'Bash', 'Skill']

}