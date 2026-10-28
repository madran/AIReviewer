import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ZodError } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const queryMock = vi.hoisted(() => vi.fn());
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: queryMock }));

import { CodeReviewOrchestrator } from '../src/orchestrator';
import { ORCHESTRATOR_PROMPT } from '../src/prompts';
import { mcpServersConfig } from '../src/config/mcp.config';
import { RateLimiter } from '../src/utils/rate-limiter';
import { ReportGenerator } from '../src/utils/report-generator';
import {
    CodeQualityResultSchema,
    TestCoverageResultSchema,
    RefactoringSuggestionSchema,
    CodeQualityResultJSONSchema,
    TestCoverageResultJSONSchema,
    RefactoringSuggestionJSONSchema,
    ReviewReportSchema,
    ReviewReportJSONSchema,
} from '../src/types';

const validCodeQuality = () => ({
    file: 'src/app.ts',
    issues: [
        {
            line: 42,
            severity: 'high' as const,
            category: 'security' as const,
            description: 'User input is concatenated into SQL query',
            suggestion: 'Use parameterized queries',
        },
    ],
    overallScore: 72,
    summary: 'One high severity security issue found.',
});

const validTestCoverage = () => ({
    file: 'src/app.ts',
    hasTests: true,
    testFiles: ['tests/app.test.ts'],
    untestedPaths: [
        {
            type: 'function' as const,
            location: 'src/app.ts:10',
            priority: 'critical' as const,
            reasoning: 'Handles authentication',
            suggestedTest: 'should reject invalid tokens',
        },
    ],
    coverageEstimate: 55,
    summary: 'Auth path is untested.',
});

const validRefactoring = () => ({
    file: 'src/app.ts',
    suggestions: [
        {
            type: 'extract-function' as const,
            location: 'src/app.ts:20-45',
            impact: 'medium' as const,
            description: 'Extract validation logic',
            before: 'if (a && b && c) { ... }',
            after: 'if (isValid(a, b, c)) { ... }',
            benefits: 'Readability and testability',
        },
    ],
    summary: 'One extract-function opportunity.',
});

const validReport = () => ({
    pullRequest: { owner: 'octocat', repo: 'Hello-World', number: 1 },
    fileReviews: [
        {
            file: 'src/app.ts',
            codeQuality: validCodeQuality(),
            testCoverage: validTestCoverage(),
            refactorings: validRefactoring(),
        },
    ],
    summary: {
        totalFiles: 1,
        overallScore: 72,
        criticalIssues: 0,
        highPriorityTests: 1,
        refactoringOpportunities: 1,
    },
    recommendations: [
        {
            priority: 'high' as const,
            category: 'security',
            description: 'Fix SQL injection risk',
            files: ['src/app.ts'],
        },
    ],
    metadata: {
        analyzedAt: '2026-10-28T12:00:00.000Z',
        duration: 1234,
        agentVersions: { quality: '1.0.0', coverage: '1.0.0', refactoring: '1.0.0' },
    },
});

const streamOf = (messages: unknown[]) =>
    (async function* () {
        for (const m of messages) yield m;
    })();

const successResult = (structured_output: unknown) => ({
    type: 'result',
    subtype: 'success',
    structured_output,
});

describe('Zod schemas', () => {
    describe('CodeQualityResultSchema', () => {
        it('accepts valid data', () => {
            expect(() => CodeQualityResultSchema.parse(validCodeQuality())).not.toThrow();
        });

        it('accepts an empty issues array', () => {
            const data = { ...validCodeQuality(), issues: [] };
            expect(CodeQualityResultSchema.parse(data).issues).toEqual([]);
        });

        it.each([0, 100])('accepts boundary overallScore %i', (score) => {
            const data = { ...validCodeQuality(), overallScore: score };
            expect(CodeQualityResultSchema.parse(data).overallScore).toBe(score);
        });

        it.each([-1, 101])('rejects out-of-range overallScore %i', (score) => {
            const data = { ...validCodeQuality(), overallScore: score };
            expect(() => CodeQualityResultSchema.parse(data)).toThrow(ZodError);
        });

        it('accepts every severity and category enum value', () => {
            const severities = ['critical', 'high', 'medium', 'low', 'info'] as const;
            const categories = [
                'security', 'performance', 'maintainability', 'style', 'bug-risk', 'best-practice',
            ] as const;
            for (const severity of severities) {
                for (const category of categories) {
                    const data = validCodeQuality();
                    data.issues[0] = { ...data.issues[0], severity, category };
                    expect(() => CodeQualityResultSchema.parse(data)).not.toThrow();
                }
            }
        });

        it('rejects an invalid severity', () => {
            const data: any = validCodeQuality();
            data.issues[0].severity = 'blocker';
            expect(() => CodeQualityResultSchema.parse(data)).toThrow(ZodError);
        });

        it('rejects an invalid category', () => {
            const data: any = validCodeQuality();
            data.issues[0].category = 'formatting';
            expect(() => CodeQualityResultSchema.parse(data)).toThrow(ZodError);
        });

        it('rejects wrong types', () => {
            const data: any = validCodeQuality();
            data.issues[0].line = '42';
            expect(() => CodeQualityResultSchema.parse(data)).toThrow(ZodError);
        });

        it('rejects missing required fields', () => {
            const { summary, ...withoutSummary } = validCodeQuality();
            expect(() => CodeQualityResultSchema.parse(withoutSummary)).toThrow(ZodError);

            const { file, ...withoutFile } = validCodeQuality();
            expect(() => CodeQualityResultSchema.parse(withoutFile)).toThrow(ZodError);
        });

        it('rejects an issue missing its suggestion', () => {
            const data: any = validCodeQuality();
            delete data.issues[0].suggestion;
            expect(() => CodeQualityResultSchema.parse(data)).toThrow(ZodError);
        });

        it('strips unknown keys rather than throwing', () => {
            const data = { ...validCodeQuality(), extra: 'ignored' };
            const parsed = CodeQualityResultSchema.parse(data);
            expect(parsed).not.toHaveProperty('extra');
        });
    });

    describe('TestCoverageResultSchema', () => {
        it('accepts valid data', () => {
            expect(() => TestCoverageResultSchema.parse(validTestCoverage())).not.toThrow();
        });

        it('accepts empty testFiles and untestedPaths with hasTests=false', () => {
            const data = { ...validTestCoverage(), hasTests: false, testFiles: [], untestedPaths: [] };
            expect(() => TestCoverageResultSchema.parse(data)).not.toThrow();
        });

        it.each([0, 100])('accepts boundary coverageEstimate %i', (value) => {
            const data = { ...validTestCoverage(), coverageEstimate: value };
            expect(TestCoverageResultSchema.parse(data).coverageEstimate).toBe(value);
        });

        it.each([-0.1, 100.1])('rejects out-of-range coverageEstimate %d', (value) => {
            const data = { ...validTestCoverage(), coverageEstimate: value };
            expect(() => TestCoverageResultSchema.parse(data)).toThrow(ZodError);
        });

        it('accepts every untestedPath type and priority', () => {
            const types = ['function', 'class', 'branch', 'edge-case'] as const;
            const priorities = ['critical', 'high', 'medium', 'low'] as const;
            for (const type of types) {
                for (const priority of priorities) {
                    const data = validTestCoverage();
                    data.untestedPaths[0] = { ...data.untestedPaths[0], type, priority };
                    expect(() => TestCoverageResultSchema.parse(data)).not.toThrow();
                }
            }
        });

        it("rejects 'info' as an untestedPath priority (only valid for quality severity)", () => {
            const data: any = validTestCoverage();
            data.untestedPaths[0].priority = 'info';
            expect(() => TestCoverageResultSchema.parse(data)).toThrow(ZodError);
        });

        it('rejects an invalid untestedPath type', () => {
            const data: any = validTestCoverage();
            data.untestedPaths[0].type = 'module';
            expect(() => TestCoverageResultSchema.parse(data)).toThrow(ZodError);
        });

        it('rejects wrong types (hasTests as string, testFiles as string)', () => {
            expect(() =>
                TestCoverageResultSchema.parse({ ...validTestCoverage(), hasTests: 'yes' })
            ).toThrow(ZodError);
            expect(() =>
                TestCoverageResultSchema.parse({ ...validTestCoverage(), testFiles: 'a.test.ts' })
            ).toThrow(ZodError);
        });

        it('rejects missing required fields', () => {
            const { hasTests, ...rest } = validTestCoverage();
            expect(() => TestCoverageResultSchema.parse(rest)).toThrow(ZodError);
        });
    });

    describe('RefactoringSuggestionSchema', () => {
        it('accepts valid data', () => {
            expect(() => RefactoringSuggestionSchema.parse(validRefactoring())).not.toThrow();
        });

        it('accepts an empty suggestions array', () => {
            const data = { ...validRefactoring(), suggestions: [] };
            expect(RefactoringSuggestionSchema.parse(data).suggestions).toEqual([]);
        });

        it('accepts every type and impact value', () => {
            const types = [
                'extract-function', 'rename', 'modernize', 'simplify', 'pattern-improvement',
            ] as const;
            const impacts = ['low', 'medium', 'high'] as const;
            for (const type of types) {
                for (const impact of impacts) {
                    const data = validRefactoring();
                    data.suggestions[0] = { ...data.suggestions[0], type, impact };
                    expect(() => RefactoringSuggestionSchema.parse(data)).not.toThrow();
                }
            }
        });

        it('rejects an invalid type', () => {
            const data: any = validRefactoring();
            data.suggestions[0].type = 'rewrite';
            expect(() => RefactoringSuggestionSchema.parse(data)).toThrow(ZodError);
        });

        it("rejects 'critical' as impact", () => {
            const data: any = validRefactoring();
            data.suggestions[0].impact = 'critical';
            expect(() => RefactoringSuggestionSchema.parse(data)).toThrow(ZodError);
        });

        it('rejects a suggestion missing before/after', () => {
            const data: any = validRefactoring();
            delete data.suggestions[0].before;
            expect(() => RefactoringSuggestionSchema.parse(data)).toThrow(ZodError);

            const data2: any = validRefactoring();
            delete data2.suggestions[0].after;
            expect(() => RefactoringSuggestionSchema.parse(data2)).toThrow(ZodError);
        });

        it('rejects non-object input', () => {
            expect(() => RefactoringSuggestionSchema.parse(null)).toThrow(ZodError);
            expect(() => RefactoringSuggestionSchema.parse('nope')).toThrow(ZodError);
            expect(() => RefactoringSuggestionSchema.parse(undefined)).toThrow(ZodError);
        });
    });

    describe('ReviewReportSchema', () => {
        it('accepts a valid full report', () => {
            expect(() => ReviewReportSchema.parse(validReport())).not.toThrow();
        });

        it('accepts a report with no files and no recommendations', () => {
            const data = { ...validReport(), fileReviews: [], recommendations: [] };
            const parsed = ReviewReportSchema.parse(data);
            expect(parsed.fileReviews).toEqual([]);
            expect(parsed.recommendations).toEqual([]);
        });

        it('accepts an empty agentVersions record and a zero duration', () => {
            const data = validReport();
            data.metadata.agentVersions = {};
            data.metadata.duration = 0;
            expect(() => ReviewReportSchema.parse(data)).not.toThrow();
        });

        it('rejects when a top-level section is missing', () => {
            for (const key of ['pullRequest', 'fileReviews', 'summary', 'recommendations', 'metadata']) {
                const data: any = validReport();
                delete data[key];
                expect(() => ReviewReportSchema.parse(data), `missing ${key}`).toThrow(ZodError);
            }
        });

        it('rejects a non-numeric PR number', () => {
            const data: any = validReport();
            data.pullRequest.number = '1';
            expect(() => ReviewReportSchema.parse(data)).toThrow(ZodError);
        });

        it('rejects an invalid recommendation priority', () => {
            const data: any = validReport();
            data.recommendations[0].priority = 'info';
            expect(() => ReviewReportSchema.parse(data)).toThrow(ZodError);
        });

        it('rejects an invalid nested fileReview (bad codeQuality score)', () => {
            const data: any = validReport();
            data.fileReviews[0].codeQuality.overallScore = 150;
            expect(() => ReviewReportSchema.parse(data)).toThrow(ZodError);
        });

        it('rejects non-string agentVersions values', () => {
            const data: any = validReport();
            data.metadata.agentVersions.quality = 1;
            expect(() => ReviewReportSchema.parse(data)).toThrow(ZodError);
        });

        it('reports the path of the failing field', () => {
            const data: any = validReport();
            data.fileReviews[0].testCoverage.coverageEstimate = 500;
            try {
                ReviewReportSchema.parse(data);
                expect.unreachable('parse should have thrown');
            } catch (err) {
                expect(err).toBeInstanceOf(ZodError);
                const paths = (err as ZodError).issues.map((i) => i.path.join('.'));
                expect(paths).toContain('fileReviews.0.testCoverage.coverageEstimate');
            }
        });

        it('safeParse returns success=false instead of throwing', () => {
            const result = ReviewReportSchema.safeParse({});
            expect(result.success).toBe(false);
        });
    });
});

describe('JSON Schema export', () => {
    const cases: Array<[string, any, string[]]> = [
        ['CodeQualityResult', CodeQualityResultJSONSchema, ['file', 'issues', 'overallScore', 'summary']],
        [
            'TestCoverageResult',
            TestCoverageResultJSONSchema,
            ['file', 'hasTests', 'testFiles', 'untestedPaths', 'coverageEstimate', 'summary'],
        ],
        ['RefactoringSuggestion', RefactoringSuggestionJSONSchema, ['file', 'suggestions', 'summary']],
        [
            'ReviewReport',
            ReviewReportJSONSchema,
            ['pullRequest', 'fileReviews', 'summary', 'recommendations', 'metadata'],
        ],
    ];

    it.each(cases)('%s is an object schema with the correct required properties', (_name, schema, required) => {
        expect(schema.type).toBe('object');
        expect(Object.keys(schema.properties).sort()).toEqual([...required].sort());
        expect([...schema.required].sort()).toEqual([...required].sort());
    });

    it.each(cases)('%s survives a JSON round trip (is valid, serializable JSON)', (_name, schema) => {
        expect(JSON.parse(JSON.stringify(schema))).toEqual(schema);
    });

    it('exports enum values for severity and category', () => {
        const issue = (CodeQualityResultJSONSchema as any).properties.issues.items;
        expect(issue.properties.severity.enum).toEqual(['critical', 'high', 'medium', 'low', 'info']);
        expect(issue.properties.category.enum).toContain('security');
        expect(issue.required).toEqual(
            expect.arrayContaining(['line', 'severity', 'category', 'description', 'suggestion'])
        );
    });

    it('exports numeric bounds for scores', () => {
        const score = (CodeQualityResultJSONSchema as any).properties.overallScore;
        expect(score.type).toBe('number');
        expect(score.minimum).toBe(0);
        expect(score.maximum).toBe(100);

        const cov = (TestCoverageResultJSONSchema as any).properties.coverageEstimate;
        expect(cov.minimum).toBe(0);
        expect(cov.maximum).toBe(100);
    });

    it('exports nested structure for the full report', () => {
        const schema = ReviewReportJSONSchema as any;
        expect([...schema.properties.pullRequest.required].sort()).toEqual(['number', 'owner', 'repo']);
        expect(schema.properties.fileReviews.type).toBe('array');
        expect(schema.properties.fileReviews.items.required).toEqual(
            expect.arrayContaining(['file', 'codeQuality', 'testCoverage', 'refactorings'])
        );
        expect(schema.properties.metadata.properties.agentVersions.additionalProperties).toEqual({
            type: 'string',
        });
    });

    it('produces the same schema the orchestrator passes to the SDK', () => {
        const fresh = zodToJsonSchema(ReviewReportSchema, { $refStrategy: 'root' });
        expect(fresh).toEqual(ReviewReportJSONSchema);
    });
});

describe('CodeReviewOrchestrator', () => {
    const originalModel = process.env.ANTHROPIC_MODEL;
    let logSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        queryMock.mockReset();
        process.env.ANTHROPIC_MODEL = 'claude-sonnet-4-5-20250929';
        logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        logSpy.mockRestore();
        if (originalModel === undefined) delete process.env.ANTHROPIC_MODEL;
        else process.env.ANTHROPIC_MODEL = originalModel;
    });

    describe('Configuration', () => {
        it('should initialize with default options', () => {
            expect(() => new CodeReviewOrchestrator()).not.toThrow();
            expect(new CodeReviewOrchestrator()).toBeInstanceOf(CodeReviewOrchestrator);
        });

        it('should accept an explicit (empty) options object', () => {
            expect(() => new CodeReviewOrchestrator({})).not.toThrow();
        });

        it('should accept custom rate limit configuration', () => {
            const limiter = new RateLimiter({
                maxRequestsPerMinute: 10,
                maxTokensPerMinute: 5000,
                maxConcurrent: 2,
            });
            const status = limiter.getStatus();
            expect(status.availableRequests).toBe(10);
            expect(status.availableTokens).toBe(5000);
            expect(status.activeRequests).toBe(0);
        });
    });

    describe('reviewPullRequest', () => {
        it('should fetch PR files from GitHub MCP', async () => {
            queryMock.mockReturnValue(streamOf([successResult(validReport())]));

            await new CodeReviewOrchestrator().reviewPullRequest('octocat', 'Hello-World', 1);

            expect(queryMock).toHaveBeenCalledTimes(1);
            const { prompt, options } = queryMock.mock.calls[0][0];

            // The PR coordinates reach the model
            expect(prompt).toContain('octocat/Hello-World#1');
            expect(prompt).toContain('owner: octocat');
            expect(prompt).toContain('repo: Hello-World');
            expect(prompt).toContain('number: 1');
            expect(prompt).toContain(ORCHESTRATOR_PROMPT.slice(0, 40).trim());

            // The GitHub MCP tools are allowed and the server is configured
            expect(options.allowedTools).toEqual(
                expect.arrayContaining([
                    'mcp__github__get_pull_request',
                    'mcp__github__get_pull_request_files',
                    'mcp__github__get_file_contents',
                ])
            );
            expect(options.mcpServers).toBe(mcpServersConfig);
            expect(options.mcpServers).toHaveProperty('github');
            expect(options.mcpServers).toHaveProperty('eslint');
        });

        it('should be read-only (no write-capable GitHub tools allowed)', async () => {
            queryMock.mockReturnValue(streamOf([successResult(validReport())]));
            await new CodeReviewOrchestrator().reviewPullRequest('o', 'r', 2);

            const { allowedTools } = queryMock.mock.calls[0][0].options;
            const writeTools = allowedTools.filter((t: string) =>
                /create|update|merge|push|comment|review/i.test(t.replace('get_pull_request_files', ''))
            );
            expect(writeTools).toEqual([]);
        });

        it('should spawn all 3 subagents in parallel', async () => {
            queryMock.mockReturnValue(streamOf([successResult(validReport())]));
            await new CodeReviewOrchestrator().reviewPullRequest('o', 'r', 3);

            const { options } = queryMock.mock.calls[0][0];

            expect(options.allowedTools).toContain('Task');

            expect(Object.keys(options.agents).sort()).toEqual(['coverage', 'quality', 'refactoring']);
            for (const agent of Object.values<any>(options.agents)) {
                expect(agent.description).toBeTruthy();
                expect(agent.prompt).toBeTruthy();
            }

            expect(ORCHESTRATOR_PROMPT).toMatch(/parallel/i);
            for (const name of ['code-quality-analyzer', 'test-coverage-analyzer', 'refactoring-suggester']) {
                expect(ORCHESTRATOR_PROMPT).toContain(name);
            }
        });

        it('should request structured output matching the report schema', async () => {
            queryMock.mockReturnValue(streamOf([successResult(validReport())]));
            await new CodeReviewOrchestrator().reviewPullRequest('o', 'r', 4);

            const { options } = queryMock.mock.calls[0][0];
            expect(options.outputFormat.type).toBe('json_schema');
            expect(options.outputFormat.schema).toEqual(ReviewReportJSONSchema);
            expect(options.model).toBe('claude-sonnet-4-5-20250929');
            expect(options.maxTurns).toBe(15);
        });

        it('should aggregate results into ReviewReport', async () => {
            const report = validReport();
            queryMock.mockReturnValue(
                streamOf([
                    { type: 'system', subtype: 'init', mcp_servers: [{ name: 'github', status: 'connected' }] },
                    { type: 'assistant', message: {} }, // unrelated message types are ignored
                    successResult(report),
                ])
            );

            const result = await new CodeReviewOrchestrator().reviewPullRequest('octocat', 'Hello-World', 1);

            expect(result).toEqual(report);
            expect(result.fileReviews).toHaveLength(1);
            expect(result.summary.totalFiles).toBe(1);
        });

        it('should validate output with Zod schema', async () => {
            const bad: any = validReport();
            bad.fileReviews[0].codeQuality.overallScore = 999;
            queryMock.mockReturnValue(streamOf([successResult(bad)]));

            await expect(
                new CodeReviewOrchestrator().reviewPullRequest('o', 'r', 5)
            ).rejects.toBeInstanceOf(ZodError);
        });

        it('should reject structured output that is missing entire sections', async () => {
            queryMock.mockReturnValue(streamOf([successResult({ pullRequest: { owner: 'o', repo: 'r', number: 1 } })]));

            await expect(
                new CodeReviewOrchestrator().reviewPullRequest('o', 'r', 1)
            ).rejects.toBeInstanceOf(ZodError);
        });

        it('should throw when the query ends with a non-success result', async () => {
            queryMock.mockReturnValue(streamOf([{ type: 'result', subtype: 'error_max_turns' }]));

            await expect(
                new CodeReviewOrchestrator().reviewPullRequest('o', 'r', 6)
            ).rejects.toThrow('Query ended with: error_max_turns');
        });

        it('should throw when the stream ends without any result message', async () => {
            queryMock.mockReturnValue(streamOf([{ type: 'system', subtype: 'init', mcp_servers: [] }]));

            await expect(
                new CodeReviewOrchestrator().reviewPullRequest('o', 'r', 7)
            ).rejects.toThrow();
        });

        it('should throw when a successful result has no structured_output', async () => {
            queryMock.mockReturnValue(streamOf([{ type: 'result', subtype: 'success' }]));

            await expect(
                new CodeReviewOrchestrator().reviewPullRequest('o', 'r', 8)
            ).rejects.toThrow();
        });

        it('should propagate errors thrown by the SDK', async () => {
            queryMock.mockImplementation(() => {
                throw new Error('network down');
            });

            await expect(
                new CodeReviewOrchestrator().reviewPullRequest('o', 'r', 9)
            ).rejects.toThrow('network down');
        });

        it('should propagate errors thrown mid-stream', async () => {
            queryMock.mockReturnValue(
                (async function* () {
                    yield { type: 'system', subtype: 'init', mcp_servers: [] };
                    throw new Error('stream aborted');
                })()
            );

            await expect(
                new CodeReviewOrchestrator().reviewPullRequest('o', 'r', 10)
            ).rejects.toThrow('stream aborted');
        });
    });

    describe('Integration', () => {
        const enabled = process.env.RUN_INTEGRATION === '1';

        it.skipIf(!enabled)(
            'should review a real small PR',
            async () => {
                vi.doUnmock('@anthropic-ai/claude-agent-sdk');
                vi.resetModules();
                const { CodeReviewOrchestrator: RealOrchestrator } = await import('../src/orchestrator');

                process.env.ANTHROPIC_MODEL = originalModel ?? process.env.ANTHROPIC_MODEL;
                const report = await new RealOrchestrator().reviewPullRequest('octocat', 'Hello-World', 1);

                expect(() => ReviewReportSchema.parse(report)).not.toThrow();
                expect(report.pullRequest).toEqual({ owner: 'octocat', repo: 'Hello-World', number: 1 });

                const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-'));
                const gen = new ReportGenerator();
                const md = path.join(dir, 'report.md');
                const html = path.join(dir, 'report.html');
                const json = path.join(dir, 'report.json');
                fs.writeFileSync(md, gen.generateMarkdownReport(report));
                fs.writeFileSync(html, gen.generateHTMLReport(report));
                fs.writeFileSync(json, gen.generateJSONReport(report));

                for (const file of [md, html, json]) {
                    expect(fs.statSync(file).size).toBeGreaterThan(0);
                }

                for (const content of [fs.readFileSync(md, 'utf-8'), fs.readFileSync(html, 'utf-8')]) {
                    expect(content).not.toContain('undefined');
                    expect(content).not.toContain('NaN');
                }
                expect(JSON.parse(fs.readFileSync(json, 'utf-8'))).toEqual(report);
                expect(report.fileReviews.length).toBeGreaterThan(0);
                expect(report.metadata.analyzedAt).toBeTruthy();
            },
            15 * 60 * 1000
        );
    });
});