# Jira Labeling Strategy for Large-Scale Projects

## 🏗️ Hierarchical Labels (Scope & Level)

### **Level Labels** - Define the hierarchy position
- `PROJECT` - Complete project scope containing all work (12+ months)
- `INITIATIVE` - Strategic business initiatives (6-12 months)
- `FEATURE` - Strategic business capabilities (3-6 months)
- `CAPABILITY` - Major functional areas within features (1-3 months)
- `COMPONENT` - Reusable technical modules (2-4 weeks)
- `MILESTONE` - Time-based delivery markers
- `FOUNDATION` - Core infrastructure that everything depends on

### **Scope Labels** - Define work size/complexity
- `SCOPE:XXL` - Initiative size (>3 months)
- `SCOPE:XL` - Extra Large (>3 weeks)
- `SCOPE:L` - Large (1-3 weeks)
- `SCOPE:M` - Medium (3-5 days)
- `SCOPE:S` - Small (1-2 days)
- `SCOPE:XS` - Extra Small (<1 day)

## 🎯 Functional Labels (Domain & Purpose)

### **Domain Labels** - Technical/Business domains
- `DOMAIN:UI` - User Interface work
- `DOMAIN:UX` - User Experience design
- `DOMAIN:API` - API development
- `DOMAIN:DB` - Database work
- `DOMAIN:AUTH` - Authentication/Authorization
- `DOMAIN:INFRA` - Infrastructure/DevOps
- `DOMAIN:INTEGRATION` - Third-party integrations
- `DOMAIN:ANALYTICS` - Analytics/Metrics
- `DOMAIN:SECURITY` - Security-related
- `DOMAIN:PERFORMANCE` - Performance optimization
- `DOMAIN:AI` - AI/ML components
- `DOMAIN:MOBILE` - Mobile-specific
- `DOMAIN:WEB` - Web-specific

### **Type Labels** - Nature of work
- `TYPE:RESEARCH` - Investigation/Spike
- `TYPE:DESIGN` - Design work
- `TYPE:IMPLEMENTATION` - Core development
- `TYPE:TESTING` - Test creation/execution
- `TYPE:DOCUMENTATION` - Documentation work
- `TYPE:REFACTOR` - Code refactoring
- `TYPE:BUGFIX` - Bug fixes
- `TYPE:OPTIMIZATION` - Performance/Cost optimization
- `TYPE:MIGRATION` - Data/System migration
- `TYPE:CONFIGURATION` - Config/Setup work

## 🚦 Status & Priority Labels

### **Priority Labels** - Business criticality
- `PRIORITY:CRITICAL` - Blocks everything
- `PRIORITY:HIGH` - Blocks major features
- `PRIORITY:MEDIUM` - Important but not blocking
- `PRIORITY:LOW` - Nice to have
- `PRIORITY:BACKLOG` - Future consideration

### **Dependency Labels** - Relationship indicators
- `BLOCKS:RELEASE` - Blocks a release
- `BLOCKS:FEATURE` - Blocks feature completion
- `BLOCKS:TEAM` - Blocks other teams
- `DEPENDENCY:EXTERNAL` - Depends on external party
- `DEPENDENCY:INTERNAL` - Internal dependencies
- `STANDALONE` - Can be done independently

## 🔄 Process & Workflow Labels

### **Phase Labels** - Development lifecycle
- `PHASE:DISCOVERY` - Research and planning
- `PHASE:DESIGN` - Design phase
- `PHASE:DEVELOPMENT` - Active development
- `PHASE:TESTING` - Testing phase
- `PHASE:REVIEW` - Code/Design review
- `PHASE:DEPLOYMENT` - Deployment phase
- `PHASE:MONITORING` - Post-deployment monitoring

### **Team Labels** - Team allocation
- `TEAM:FRONTEND` - Frontend team
- `TEAM:BACKEND` - Backend team
- `TEAM:FULLSTACK` - Full-stack work
- `TEAM:DEVOPS` - DevOps team
- `TEAM:QA` - QA team
- `TEAM:DESIGN` - Design team
- `TEAM:PRODUCT` - Product team
- `TEAM:DATA` - Data team

## 🎨 Special Purpose Labels

### **Risk Labels** - Risk assessment
- `RISK:HIGH` - High risk changes
- `RISK:MEDIUM` - Moderate risk
- `RISK:LOW` - Low risk
- `RISK:SECURITY` - Security implications
- `RISK:BREAKING` - Breaking changes

### **Review Labels** - Review requirements
- `NEEDS:REVIEW` - Needs review
- `NEEDS:APPROVAL` - Needs approval
- `NEEDS:TESTING` - Needs testing
- `NEEDS:DOCUMENTATION` - Needs documentation
- `READY:PRODUCTION` - Ready for production

### **Sprint Labels** - Sprint management
- `SPRINT:READY` - Ready for sprint
- `SPRINT:CARRYOVER` - Carried from previous sprint
- `SPRINT:STRETCH` - Stretch goal
- `SPRINT:COMMITTED` - Committed for sprint

## 📊 Label Combination Rules

### **Initiative Level**
Should have:
- `INITIATIVE`
- `SCOPE:XXL` (new size for initiatives)
- Multiple `DOMAIN:*` labels
- `PRIORITY:*` label
- Strategic alignment labels

Example: `INITIATIVE`, `SCOPE:XXL`, `DOMAIN:UI`, `DOMAIN:API`, `DOMAIN:AI`, `PRIORITY:CRITICAL`

### **Feature/Epic Level**
Should have:
- `FEATURE` or `CAPABILITY`
- `SCOPE:XL` or `SCOPE:L`
- One or more `DOMAIN:*` labels
- `PRIORITY:*` label

Example: `FEATURE`, `SCOPE:XL`, `DOMAIN:UI`, `DOMAIN:API`, `PRIORITY:HIGH`

### **Story Level**
Should have:
- `SCOPE:M` or `SCOPE:S`
- One primary `DOMAIN:*` label
- One `TYPE:*` label
- `TEAM:*` label
- Current `PHASE:*` label

Example: `SCOPE:M`, `DOMAIN:API`, `TYPE:IMPLEMENTATION`, `TEAM:BACKEND`, `PHASE:DEVELOPMENT`

### **Task Level**
Should have:
- `SCOPE:S` or `SCOPE:XS`
- Specific `TYPE:*` label
- `TEAM:*` label
- Any `NEEDS:*` labels

Example: `SCOPE:S`, `TYPE:TESTING`, `TEAM:QA`, `NEEDS:REVIEW`

## 🎯 Decision Framework

### **When to use INITIATIVE label:**
- Represents a strategic business initiative
- Contains multiple features
- Spans 6-12 months
- Aligns with company OKRs or strategic goals
- Requires cross-team coordination

### **When to use FEATURE label:**
- Represents a complete business capability
- Takes multiple sprints to complete
- Has multiple epics/stories underneath
- Directly maps to business objectives
- Part of a larger initiative

### **When to use CAPABILITY label:**
- Major functional area within a feature
- Can be delivered independently
- Has clear acceptance criteria
- Provides measurable value

### **When to use COMPONENT label:**
- Reusable technical module
- Shared across multiple features
- Has defined interfaces/APIs
- Can be versioned independently

### **When to use MILESTONE label:**
- Time-based delivery marker
- Groups work across multiple features
- Has a fixed deadline
- Represents a major release

## 🔄 Label Lifecycle

### **Creation Phase**
1. Add hierarchical label (`FEATURE`, `CAPABILITY`, etc.)
2. Add scope label based on estimation
3. Add relevant domain labels
4. Set initial priority

### **Planning Phase**
1. Add team assignments
2. Add dependency labels
3. Add phase labels
4. Add sprint readiness labels

### **Execution Phase**
1. Update phase labels as work progresses
2. Add/remove `NEEDS:*` labels
3. Add risk labels if identified
4. Update priority if changed

### **Completion Phase**
1. Add `READY:PRODUCTION` when complete
2. Remove `NEEDS:*` labels
3. Add any follow-up labels
4. Archive sprint-specific labels

## 📈 Benefits of This Labeling System

1. **Clear Hierarchy** - Easy to understand project structure
2. **Filtering Power** - Quick views of specific work types
3. **Dependency Tracking** - Visual dependency management
4. **Team Allocation** - Clear ownership and responsibility
5. **Progress Tracking** - Phase labels show workflow state
6. **Risk Management** - Identify high-risk items quickly
7. **Sprint Planning** - Ready/blocked items clearly marked
8. **Cross-functional View** - Domain labels show impact
9. **Scalability** - Works for projects of any size
10. **Automation Ready** - Labels enable automated workflows

## 🚀 Quick Start Labels

### **Minimum Required Labels** (Start with these)
1. `INITIATIVE` or `FEATURE` - For hierarchy level
2. `SCOPE:*` - Size estimation
3. `DOMAIN:*` - Technical area
4. `PRIORITY:*` - Business priority
5. `TEAM:*` - Team assignment

### **Add as Needed**
- Dependency labels when blockers identified
- Risk labels for sensitive changes
- Phase labels for workflow tracking
- Special purpose labels for specific needs

## 🔍 Example JQL Queries

```jql
# All Initiatives
labels = "INITIATIVE"

# All Features
labels = "FEATURE"

# High priority backend work
labels = "PRIORITY:HIGH" AND labels = "TEAM:BACKEND"

# Sprint-ready medium scope stories
labels = "SPRINT:READY" AND labels = "SCOPE:M" AND type = Story

# Blocked items
labels in ("BLOCKS:RELEASE", "BLOCKS:FEATURE", "BLOCKS:TEAM")

# Frontend work in development phase
labels = "DOMAIN:UI" AND labels = "PHASE:DEVELOPMENT"

# Items needing review
labels = "NEEDS:REVIEW"

# Critical security risks
labels = "PRIORITY:CRITICAL" AND labels = "RISK:SECURITY"
```

---

This labeling strategy provides a comprehensive yet flexible system for organizing large-scale projects in Jira, making it easy to filter, track, and manage work at any level of granularity.