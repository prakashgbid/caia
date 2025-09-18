const TaskForgeDatabase = require('./database');
const { exec } = require('child_process');
const { promisify } = require('util');
const execPromise = promisify(exec);

class TaskDecomposer {
    constructor(db) {
        this.db = db;

        // Task hierarchy levels
        this.levels = ['initiative', 'epic', 'feature', 'story', 'task', 'subtask', 'microtask'];

        // Keyword patterns for different task types
        this.patterns = {
            initiative: ['platform', 'system', 'ecosystem', 'infrastructure', 'architecture'],
            epic: ['module', 'service', 'component', 'integration', 'workflow'],
            feature: ['functionality', 'capability', 'interface', 'dashboard', 'api'],
            story: ['user can', 'as a', 'enable', 'allow', 'provide'],
            task: ['implement', 'create', 'build', 'develop', 'setup'],
            subtask: ['add', 'update', 'modify', 'configure', 'install'],
            microtask: ['fix', 'adjust', 'tweak', 'rename', 'move']
        };

        // Complexity indicators
        this.complexityIndicators = {
            trivial: ['rename', 'move', 'fix typo', 'update text'],
            simple: ['add button', 'change color', 'update config', 'add field'],
            medium: ['create form', 'implement api', 'add validation', 'build component'],
            complex: ['integrate service', 'implement auth', 'build dashboard', 'create workflow'],
            epic: ['build platform', 'create system', 'develop framework', 'architect solution']
        };
    }

    /**
     * Main decomposition method - takes a high-level description and creates full hierarchy
     */
    async decompose(input, options = {}) {
        const {
            maxDepth = 7,
            autoGenerate = true,
            includeTests = true,
            includeApis = true,
            checkCKS = true,
            projectId = null,
            projectName = null
        } = options;

        console.log(`📝 Decomposing: "${input}"`);

        // Determine which project to assign to
        let assignToProject = projectId;
        if (!assignToProject && projectName) {
            const project = await this.db.getProjectByName(projectName);
            if (project) {
                assignToProject = project.id;
                console.log(`📁 Assigning to project: ${projectName}`);
            }
        }

        // Analyze the input to determine starting level
        const startLevel = this.detectLevel(input);
        const complexity = this.detectComplexity(input);

        // Create root task with project assignment
        const rootTask = await this.createRootTask(input, startLevel, complexity, assignToProject);

        // Recursively decompose into subtasks
        if (autoGenerate) {
            await this.recursiveDecompose(rootTask, startLevel, 0, maxDepth);
        }

        // Generate acceptance criteria for all tasks
        await this.generateAcceptanceCriteria(rootTask.id);

        // Detect and add API specifications
        if (includeApis) {
            await this.detectAndAddApis(rootTask.id);
        }

        // Generate test cases
        if (includeTests) {
            await this.generateTestCases(rootTask.id);
        }

        // Check CKS for existing implementations
        if (checkCKS) {
            await this.checkExistingImplementations(rootTask.id);
        }

        // Return the complete hierarchy
        return await this.db.getTask(rootTask.id);
    }

    /**
     * Detect the starting level based on input keywords
     */
    detectLevel(input) {
        const lower = input.toLowerCase();

        for (const [level, keywords] of Object.entries(this.patterns)) {
            for (const keyword of keywords) {
                if (lower.includes(keyword)) {
                    return level;
                }
            }
        }

        // Default based on word count
        const wordCount = input.split(' ').length;
        if (wordCount < 5) return 'task';
        if (wordCount < 10) return 'story';
        if (wordCount < 20) return 'feature';
        return 'epic';
    }

    /**
     * Detect complexity based on input
     */
    detectComplexity(input) {
        const lower = input.toLowerCase();

        for (const [complexity, indicators] of Object.entries(this.complexityIndicators)) {
            for (const indicator of indicators) {
                if (lower.includes(indicator)) {
                    return complexity;
                }
            }
        }

        // Default based on word count
        const wordCount = input.split(' ').length;
        if (wordCount < 5) return 'simple';
        if (wordCount < 15) return 'medium';
        if (wordCount < 30) return 'complex';
        return 'epic';
    }

    /**
     * Create the root task
     */
    async createRootTask(input, level, complexity, projectId = null) {
        const taskId = await this.db.createTask({
            title: this.generateTitle(input),
            description: input,
            level: level,
            complexity: complexity,
            priority: complexity === 'epic' ? 'P0' : complexity === 'complex' ? 'P1' : 'P2',
            estimated_hours: this.estimateHours(complexity),
            path: level,
            project_id: projectId
        });

        return await this.db.getTask(taskId);
    }

    /**
     * Recursively decompose task into subtasks
     */
    async recursiveDecompose(parentTask, parentLevel, currentDepth, maxDepth) {
        if (currentDepth >= maxDepth) return;

        const levelIndex = this.levels.indexOf(parentLevel);
        if (levelIndex >= this.levels.length - 1) return;

        const childLevel = this.levels[levelIndex + 1];
        const subtasks = this.generateSubtasks(parentTask, childLevel);

        for (const subtask of subtasks) {
            const childId = await this.db.createTask({
                ...subtask,
                parent_id: parentTask.id,
                path: `${parentTask.path || parentTask.level}.${childLevel}`,
                level: childLevel
            });

            const childTask = await this.db.getTask(childId);

            // Recursively decompose further
            if (levelIndex < this.levels.length - 2) {
                await this.recursiveDecompose(childTask, childLevel, currentDepth + 1, maxDepth);
            }
        }
    }

    /**
     * Generate subtasks based on parent task
     */
    generateSubtasks(parentTask, targetLevel) {
        const subtasks = [];
        const baseTitle = parentTask.title.replace(/^(Create|Build|Implement|Develop)\s+/i, '');

        // Generate subtasks based on target level
        switch (targetLevel) {
            case 'epic':
                subtasks.push(
                    { title: `Backend Services for ${baseTitle}`, description: `Implement all backend services and APIs for ${baseTitle}`, complexity: 'complex', estimated_hours: 40 },
                    { title: `Frontend Interface for ${baseTitle}`, description: `Create user interface and interactions for ${baseTitle}`, complexity: 'complex', estimated_hours: 32 },
                    { title: `Data Layer for ${baseTitle}`, description: `Design and implement data models and storage for ${baseTitle}`, complexity: 'medium', estimated_hours: 24 }
                );
                break;

            case 'feature':
                subtasks.push(
                    { title: `Core Functionality`, description: `Implement the main features`, complexity: 'medium', estimated_hours: 16 },
                    { title: `User Management`, description: `Handle user authentication and authorization`, complexity: 'medium', estimated_hours: 12 },
                    { title: `Data Processing`, description: `Process and validate data`, complexity: 'medium', estimated_hours: 8 },
                    { title: `Integration Points`, description: `Connect with external services`, complexity: 'complex', estimated_hours: 16 }
                );
                break;

            case 'story':
                subtasks.push(
                    { title: `As a user, I can view the dashboard`, description: `Users should see a comprehensive dashboard`, complexity: 'medium', estimated_hours: 8 },
                    { title: `As a user, I can create new items`, description: `Users should be able to create new entities`, complexity: 'simple', estimated_hours: 4 },
                    { title: `As a user, I can edit existing items`, description: `Users should be able to modify entities`, complexity: 'simple', estimated_hours: 4 },
                    { title: `As a user, I can delete items`, description: `Users should be able to remove entities`, complexity: 'simple', estimated_hours: 2 }
                );
                break;

            case 'task':
                subtasks.push(
                    { title: `Design the schema`, description: `Create database schema and models`, complexity: 'simple', estimated_hours: 2 },
                    { title: `Implement the logic`, description: `Write the business logic`, complexity: 'medium', estimated_hours: 4 },
                    { title: `Create the UI`, description: `Build user interface components`, complexity: 'simple', estimated_hours: 3 },
                    { title: `Add validation`, description: `Implement input validation and error handling`, complexity: 'simple', estimated_hours: 2 },
                    { title: `Write tests`, description: `Create unit and integration tests`, complexity: 'simple', estimated_hours: 3 }
                );
                break;

            case 'subtask':
                subtasks.push(
                    { title: `Setup environment`, description: `Configure development environment`, complexity: 'trivial', estimated_hours: 0.5 },
                    { title: `Install dependencies`, description: `Add required packages`, complexity: 'trivial', estimated_hours: 0.25 },
                    { title: `Create base structure`, description: `Setup initial file structure`, complexity: 'trivial', estimated_hours: 0.5 },
                    { title: `Implement core function`, description: `Write the main functionality`, complexity: 'simple', estimated_hours: 1 },
                    { title: `Add error handling`, description: `Handle edge cases`, complexity: 'simple', estimated_hours: 0.5 }
                );
                break;

            case 'microtask':
                subtasks.push(
                    { title: `Create file`, description: `Create the necessary file`, complexity: 'trivial', estimated_hours: 0.1 },
                    { title: `Add imports`, description: `Import required modules`, complexity: 'trivial', estimated_hours: 0.1 },
                    { title: `Write function`, description: `Implement the function`, complexity: 'trivial', estimated_hours: 0.25 },
                    { title: `Add comments`, description: `Document the code`, complexity: 'trivial', estimated_hours: 0.1 }
                );
                break;
        }

        return subtasks;
    }

    /**
     * Generate acceptance criteria for a task and its children
     */
    async generateAcceptanceCriteria(taskId) {
        const task = await this.db.getTask(taskId);

        // Generate criteria based on task level and description
        const criteria = this.generateCriteriaForTask(task);

        for (const criterion of criteria) {
            await this.db.addAcceptanceCriteria(taskId, criterion);
        }

        // Process children
        if (task.children && task.children.length > 0) {
            for (const child of task.children) {
                await this.generateAcceptanceCriteria(child.id);
            }
        }
    }

    /**
     * Generate specific acceptance criteria for a task
     */
    generateCriteriaForTask(task) {
        const criteria = [];

        // Add standard criteria based on task level
        switch (task.level) {
            case 'story':
                criteria.push(
                    {
                        given: 'The user is on the main page',
                        when: 'They interact with the feature',
                        then: 'The expected functionality works correctly',
                        priority: 'must'
                    },
                    {
                        given: 'The user provides invalid input',
                        when: 'They attempt to submit',
                        then: 'Appropriate error messages are displayed',
                        priority: 'must'
                    }
                );
                break;

            case 'task':
                criteria.push(
                    {
                        given: 'The implementation is complete',
                        when: 'The code is executed',
                        then: 'All unit tests pass',
                        priority: 'must'
                    },
                    {
                        given: 'The feature is integrated',
                        when: 'The system is tested',
                        then: 'No regressions occur',
                        priority: 'should'
                    }
                );
                break;

            default:
                criteria.push({
                    given: 'The task is implemented',
                    when: 'It is reviewed',
                    then: 'It meets all requirements',
                    priority: 'must'
                });
        }

        return criteria;
    }

    /**
     * Detect and add API specifications
     */
    async detectAndAddApis(taskId) {
        const task = await this.db.getTask(taskId);

        // Detect API needs from task description
        const apis = this.detectApis(task);

        for (const api of apis) {
            // Check if API exists in CKS
            const cksReference = await this.checkCKSForApi(api.endpoint);

            await this.db.addApiSpec(taskId, {
                ...api,
                cks_reference: cksReference,
                status: cksReference ? 'existing' : 'new'
            });
        }

        // Process children
        if (task.children && task.children.length > 0) {
            for (const child of task.children) {
                await this.detectAndAddApis(child.id);
            }
        }
    }

    /**
     * Detect APIs from task description
     */
    detectApis(task) {
        const apis = [];
        const description = (task.description || task.title).toLowerCase();

        // Common CRUD operations
        if (description.includes('create') || description.includes('add')) {
            apis.push({
                endpoint: `/api/${this.extractEntity(description)}`,
                method: 'POST',
                request_schema: { type: 'object' },
                response_schema: { type: 'object', properties: { id: { type: 'string' } } }
            });
        }

        if (description.includes('view') || description.includes('get') || description.includes('list')) {
            apis.push({
                endpoint: `/api/${this.extractEntity(description)}`,
                method: 'GET',
                request_schema: null,
                response_schema: { type: 'array' }
            });
        }

        if (description.includes('update') || description.includes('edit')) {
            apis.push({
                endpoint: `/api/${this.extractEntity(description)}/:id`,
                method: 'PUT',
                request_schema: { type: 'object' },
                response_schema: { type: 'object' }
            });
        }

        if (description.includes('delete') || description.includes('remove')) {
            apis.push({
                endpoint: `/api/${this.extractEntity(description)}/:id`,
                method: 'DELETE',
                request_schema: null,
                response_schema: { success: { type: 'boolean' } }
            });
        }

        return apis;
    }

    /**
     * Generate test cases for a task
     */
    async generateTestCases(taskId) {
        const task = await this.db.getTask(taskId);

        // Generate test cases based on acceptance criteria
        for (const criterion of task.acceptance_criteria || []) {
            await this.db.addTestCase(taskId, {
                type: task.level === 'microtask' ? 'unit' : task.level === 'task' ? 'integration' : 'e2e',
                description: `Test: ${criterion.given_statement} -> ${criterion.when_statement} -> ${criterion.then_statement}`,
                steps: [
                    `Setup: ${criterion.given_statement}`,
                    `Action: ${criterion.when_statement}`,
                    `Assert: ${criterion.then_statement}`
                ],
                expected_result: criterion.then_statement,
                edge_cases: this.generateEdgeCases(task)
            });
        }

        // Process children
        if (task.children && task.children.length > 0) {
            for (const child of task.children) {
                await this.generateTestCases(child.id);
            }
        }
    }

    /**
     * Generate edge cases for testing
     */
    generateEdgeCases(task) {
        const edgeCases = [];

        // Standard edge cases
        edgeCases.push('Empty input', 'Null values', 'Maximum length input');

        // Level-specific edge cases
        if (task.level === 'story' || task.level === 'feature') {
            edgeCases.push('Concurrent users', 'Network failure', 'Permission denied');
        }

        if (task.level === 'task' || task.level === 'subtask') {
            edgeCases.push('Invalid data type', 'Boundary values', 'Race conditions');
        }

        return edgeCases;
    }

    /**
     * Check CKS for existing implementations
     */
    async checkExistingImplementations(taskId) {
        const task = await this.db.getTask(taskId);

        try {
            // Check if CKS is running
            const { stdout } = await execPromise('curl -s http://localhost:5555/search/function?query=' + encodeURIComponent(task.title));
            const results = JSON.parse(stdout);

            if (results.functions && results.functions.length > 0) {
                // Add note about existing implementations
                await this.db.addHistory(taskId, 'cks_check', 'system',
                    JSON.stringify(results.functions.slice(0, 3)),
                    `Found ${results.functions.length} existing implementations in CKS`
                );

                // Add label
                await this.db.addLabel(taskId, 'has-existing-impl', '#FFA500');
            }
        } catch (error) {
            // CKS not available or error - continue without it
            console.log('CKS check skipped:', error.message);
        }

        // Process children
        if (task.children && task.children.length > 0) {
            for (const child of task.children) {
                await this.checkExistingImplementations(child.id);
            }
        }
    }

    /**
     * Check CKS for specific API
     */
    async checkCKSForApi(endpoint) {
        try {
            const { stdout } = await execPromise('curl -s http://localhost:5555/search/function?query=' + encodeURIComponent(endpoint));
            const results = JSON.parse(stdout);

            if (results.functions && results.functions.length > 0) {
                return results.functions[0].id;
            }
        } catch (error) {
            // CKS not available
        }
        return null;
    }

    /**
     * Helper: Generate title from description
     */
    generateTitle(description) {
        // Clean and truncate to create a title
        const cleaned = description.replace(/[^\w\s]/g, ' ').trim();
        const words = cleaned.split(' ').slice(0, 5);
        return words.join(' ');
    }

    /**
     * Helper: Estimate hours based on complexity
     */
    estimateHours(complexity) {
        const estimates = {
            trivial: 0.5,
            simple: 2,
            medium: 8,
            complex: 24,
            epic: 80
        };
        return estimates[complexity] || 4;
    }

    /**
     * Helper: Extract entity name from description
     */
    extractEntity(description) {
        // Simple extraction - find noun after verb
        const matches = description.match(/(?:create|view|update|delete|add|edit|remove)\s+(\w+)/i);
        return matches ? matches[1] : 'entity';
    }
}

module.exports = TaskDecomposer;