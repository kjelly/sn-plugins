import type { TemplateDefinition, SnippetDefinition } from "./TemplateEngine.ts";

export const BUILTIN_TEMPLATES: TemplateDefinition[] = [
  {
    id: "builtin-project",
    name: "Project Plan",
    description: "Standard project overview with milestones, tasks, and risk assessments",
    category: "Project",
    content: `# {{noteTitle}}

> **Created:** {{datetime}}  
> **Status:** Planning · In Progress · Completed

## 1. Project Overview & Goals
- **Objective:** {{cursor}}
- **Target Audience:** 
- **Success Criteria:** 

## 2. Milestones & Timeline
- [ ] Milestone 1: Requirements & Architecture @repeat(0d)
- [ ] Milestone 2: Core Implementation
- [ ] Milestone 3: Testing & Quality Assurance
- [ ] Milestone 4: Deployment & Release

## 3. Key Tasks
- [ ] Task 1: Initialize project setup
- [ ] Task 2: Implement core functionality
- [ ] Task 3: Write automated tests

## 4. Risks & Mitigations
- **Risk:** 
  - *Mitigation:* 

## 5. References & Resources
- 
`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "builtin-knowledge",
    name: "Knowledge Note",
    description: "Structured concept explanation, key takeaways, and references",
    category: "Knowledge",
    content: `# {{noteTitle}}

> **Date:** {{date}}  
> **Tags:** #knowledge

## Summary
{{cursor}}

## Core Concepts & Key Takeaways
1. **Concept 1:** 
2. **Concept 2:** 

## Detailed Notes & Examples
\`\`\`ts
// Code or technical example
\`\`\`

## Related Topics & References
- 
`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "builtin-research",
    name: "Research & Evaluation",
    description: "Problem statement, evaluated alternatives, matrix, and recommendations",
    category: "Research",
    content: `# {{noteTitle}} — Research & Evaluation

> **Evaluator:**   
> **Date:** {{date}}

## 1. Problem Statement
{{cursor}}

## 2. Options Considered

### Option A: 
- **Pros:**
  - 
- **Cons:**
  - 

### Option B: 
- **Pros:**
  - 
- **Cons:**
  - 

## 3. Comparison Matrix
| Criteria | Weight | Option A | Option B |
| :--- | :---: | :---: | :---: |
| Performance | High | ★★★★☆ | ★★★☆☆ |
| Maintenance | Medium | ★★★★☆ | ★★★★★ |
| Cost | High | ★★★★★ | ★★☆☆☆ |

## 4. Recommendation & Next Steps
- **Decision:** 
- [ ] Next Action 1
- [ ] Next Action 2
`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "builtin-troubleshooting",
    name: "Troubleshooting & Incident",
    description: "Issue investigation, environment details, root cause, and resolution",
    category: "Operations",
    content: `# Incident Report: {{noteTitle}}

> **Incident Date:** {{date}}  
> **Severity:** Critical · Major · Minor  
> **Resolution Status:** Investigating · Resolved

## 1. Symptoms & Impact
- **Symptom:** {{cursor}}
- **Impacted Services:** 

## 2. Environment & Context
- **OS / Runtime:** 
- **Version:** 
- **Logs / Error Output:**
\`\`\`text

\`\`\`

## 3. Root Cause Analysis (5 Whys)
1. 

## 4. Resolution & Fix
- [ ] Fix applied: 

## 5. Preventative Actions
- [ ] Action item 1
- [ ] Action item 2
`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "builtin-weekly-plan",
    name: "Weekly Plan & Review",
    description: "Weekly goals, daily task breakdown, and weekend retrospective",
    category: "Planning",
    content: `# Weekly Plan — Week of {{date}}

## Focus of the Week
- [ ] Main Goal 1: {{cursor}}
- [ ] Main Goal 2: 
- [ ] Main Goal 3: 

## Daily Tasks

### Monday
- [ ] 

### Tuesday
- [ ] 

### Wednesday
- [ ] 

### Thursday
- [ ] 

### Friday
- [ ] 

## Weekly Review & Retrospective
- **What went well:**
  - 
- **Challenges encountered:**
  - 
- **Carried over to next week:**
  - 
`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

export const BUILTIN_SNIPPETS: SnippetDefinition[] = [
  {
    id: "builtin-snippet-decision",
    name: "Decision Record",
    description: "Architecture decision record format",
    category: "Architecture",
    trigger: "decision",
    content: `### Decision: {{cursor}}
> **Date:** {{date}} | **Status:** Proposed · Accepted · Superseded

- **Context:** {{selection}}
- **Decision:** 
- **Consequences:** 
`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "builtin-snippet-reference",
    name: "Citation / Reference",
    description: "Reference link with author and quote",
    category: "General",
    trigger: "reference",
    content: `> "{{selection}}"
> — [{{cursor}}Source Title](URL), {{date}}
`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "builtin-snippet-command",
    name: "CLI Command Block",
    description: "Fenced code block with bash command and explanation",
    category: "DevOps",
    trigger: "command",
    content: `\`\`\`bash
# {{cursor}}
{{selection}}
\`\`\`
`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];
