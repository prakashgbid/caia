const { exec } = require('child_process');
const { promisify } = require('util');
const execPromise = promisify(exec);
const path = require('path');

class GitIntegration {
    constructor(db, repoPath = '/Users/MAC/Documents/projects/caia') {
        this.db = db;
        this.repoPath = repoPath;
        this.taskPattern = /\[(task-[a-zA-Z0-9-]+)\]/gi;  // Pattern to match task IDs in commit messages
    }

    /**
     * Scan git history and link commits to tasks
     */
    async syncCommits(since = null) {
        try {
            // Get git log with file changes
            const sinceFlag = since ? `--since="${since}"` : '--max-count=100';
            const { stdout } = await execPromise(
                `git log ${sinceFlag} --pretty=format:"%H|%an|%ae|%at|%s" --name-status`,
                { cwd: this.repoPath }
            );

            const commits = this.parseGitLog(stdout);

            // Process each commit
            for (const commit of commits) {
                await this.processCommit(commit);
            }

            console.log(`✅ Synced ${commits.length} commits with TaskForge`);
            return commits.length;

        } catch (error) {
            console.error('Git sync error:', error);
            throw error;
        }
    }

    /**
     * Parse git log output
     */
    parseGitLog(logOutput) {
        const commits = [];
        const lines = logOutput.split('\n');
        let currentCommit = null;
        let filesChanged = [];

        for (const line of lines) {
            if (line.includes('|')) {
                // New commit line
                if (currentCommit) {
                    currentCommit.files_changed = filesChanged;
                    commits.push(currentCommit);
                    filesChanged = [];
                }

                const [hash, author, email, timestamp, message] = line.split('|');
                currentCommit = {
                    hash,
                    author,
                    email,
                    timestamp: new Date(parseInt(timestamp) * 1000),
                    message,
                    additions: 0,
                    deletions: 0
                };
            } else if (line.match(/^[AMD]\t/)) {
                // File change line
                const [status, ...filePath] = line.split('\t');
                filesChanged.push({
                    status: status,
                    path: filePath.join('\t')
                });

                // Count additions/deletions (simplified)
                if (status === 'A') currentCommit.additions++;
                if (status === 'D') currentCommit.deletions++;
                if (status === 'M') {
                    currentCommit.additions++;
                    currentCommit.deletions++;
                }
            }
        }

        // Don't forget the last commit
        if (currentCommit) {
            currentCommit.files_changed = filesChanged;
            commits.push(currentCommit);
        }

        return commits;
    }

    /**
     * Process a single commit
     */
    async processCommit(commit) {
        // Extract task IDs from commit message
        const taskIds = this.extractTaskIds(commit.message);

        if (taskIds.length === 0) {
            // Try to infer task from files changed
            const inferredTaskIds = await this.inferTaskFromFiles(commit.files_changed);
            taskIds.push(...inferredTaskIds);
        }

        // Link commit to each task
        for (const taskId of taskIds) {
            try {
                await this.db.linkCommit(taskId, {
                    hash: commit.hash,
                    message: commit.message,
                    author: commit.author,
                    timestamp: commit.timestamp,
                    files_changed: commit.files_changed,
                    additions: commit.additions,
                    deletions: commit.deletions
                });

                // Update task status if mentioned in commit
                await this.updateTaskStatus(taskId, commit.message);

                console.log(`  Linked commit ${commit.hash.substr(0, 7)} to task ${taskId}`);
            } catch (error) {
                // Task might not exist
                console.log(`  Task ${taskId} not found, skipping`);
            }
        }
    }

    /**
     * Extract task IDs from commit message
     */
    extractTaskIds(message) {
        const matches = message.match(this.taskPattern);
        if (!matches) return [];

        return matches.map(match => match.replace(/[\[\]]/g, ''));
    }

    /**
     * Infer task ID from changed files
     */
    async inferTaskFromFiles(files) {
        const taskIds = new Set();

        for (const file of files) {
            // Look for task IDs in file paths or names
            const pathMatches = file.path.match(this.taskPattern);
            if (pathMatches) {
                pathMatches.forEach(match => taskIds.add(match.replace(/[\[\]]/g, '')));
            }

            // Check if file is related to any active tasks
            const activeTasks = await this.db.getTasksByStatus('in_progress');
            for (const task of activeTasks) {
                // Simple heuristic: check if file path contains keywords from task title
                const keywords = task.title.toLowerCase().split(' ').filter(w => w.length > 3);
                const fileLower = file.path.toLowerCase();

                if (keywords.some(keyword => fileLower.includes(keyword))) {
                    taskIds.add(task.id);
                }
            }
        }

        return Array.from(taskIds);
    }

    /**
     * Update task status based on commit message
     */
    async updateTaskStatus(taskId, message) {
        const lower = message.toLowerCase();

        if (lower.includes('complete') || lower.includes('done') || lower.includes('finish')) {
            await this.db.updateTask(taskId, {
                status: 'completed',
                completed_at: new Date().toISOString()
            });
        } else if (lower.includes('wip') || lower.includes('in progress') || lower.includes('working')) {
            await this.db.updateTask(taskId, { status: 'in_progress' });
        } else if (lower.includes('blocked') || lower.includes('stuck')) {
            await this.db.updateTask(taskId, { status: 'blocked' });
        }
    }

    /**
     * Create a commit for a task
     */
    async createCommit(taskId, message = null) {
        const task = await this.db.getTask(taskId);
        if (!task) throw new Error('Task not found');

        // Generate commit message if not provided
        const commitMessage = message || this.generateCommitMessage(task);

        try {
            // Stage all changes
            await execPromise('git add -A', { cwd: this.repoPath });

            // Create commit with task reference
            const { stdout } = await execPromise(
                `git commit -m "[${taskId}] ${commitMessage}"`,
                { cwd: this.repoPath }
            );

            console.log(`✅ Created commit for task ${taskId}`);
            return stdout;

        } catch (error) {
            if (error.message.includes('nothing to commit')) {
                console.log('No changes to commit');
                return null;
            }
            throw error;
        }
    }

    /**
     * Generate commit message from task
     */
    generateCommitMessage(task) {
        const typeMap = {
            feature: 'feat',
            bug: 'fix',
            task: 'chore',
            documentation: 'docs',
            test: 'test'
        };

        const type = typeMap[task.level] || 'chore';
        const scope = task.path ? task.path.split('.')[0] : task.level;

        return `${type}(${scope}): ${task.title}`;
    }

    /**
     * Generate release notes from completed tasks
     */
    async generateReleaseNotes(since = '1 week ago') {
        const completedTasks = await this.db.all(`
            SELECT t.*, GROUP_CONCAT(c.hash) as commits
            FROM tasks t
            LEFT JOIN commits c ON c.task_id = t.id
            WHERE t.status = 'completed'
            AND t.completed_at > datetime('now', '-7 days')
            GROUP BY t.id
            ORDER BY t.level, t.priority
        `);

        const notes = {
            features: [],
            fixes: [],
            improvements: [],
            tasks: []
        };

        for (const task of completedTasks) {
            const entry = `- ${task.title} ${task.commits ? `(${task.commits.split(',').length} commits)` : ''}`;

            if (task.level === 'feature') {
                notes.features.push(entry);
            } else if (task.title.toLowerCase().includes('fix') || task.title.toLowerCase().includes('bug')) {
                notes.fixes.push(entry);
            } else if (task.level === 'story' || task.level === 'epic') {
                notes.improvements.push(entry);
            } else {
                notes.tasks.push(entry);
            }
        }

        // Format release notes
        let releaseNotes = `# Release Notes - ${new Date().toISOString().split('T')[0]}\n\n`;

        if (notes.features.length > 0) {
            releaseNotes += `## 🎉 New Features\n${notes.features.join('\n')}\n\n`;
        }

        if (notes.fixes.length > 0) {
            releaseNotes += `## 🐛 Bug Fixes\n${notes.fixes.join('\n')}\n\n`;
        }

        if (notes.improvements.length > 0) {
            releaseNotes += `## 💪 Improvements\n${notes.improvements.join('\n')}\n\n`;
        }

        if (notes.tasks.length > 0) {
            releaseNotes += `## 🔧 Other Changes\n${notes.tasks.join('\n')}\n\n`;
        }

        releaseNotes += `\n---\nGenerated by TaskForge`;

        return releaseNotes;
    }

    /**
     * Setup git hooks for automatic tracking
     */
    async setupGitHooks() {
        const hookContent = `#!/bin/bash
# TaskForge Auto-link Hook

# Extract task ID from branch name or commit message
TASK_ID=$(git rev-parse --abbrev-ref HEAD | grep -oE 'task-[a-zA-Z0-9-]+' || echo "")

# If no task ID in branch, check commit message
if [ -z "$TASK_ID" ]; then
    TASK_ID=$(cat $1 | grep -oE '\\[task-[a-zA-Z0-9-]+\\]' | tr -d '[]' || echo "")
fi

# If still no task ID, prompt user
if [ -z "$TASK_ID" ]; then
    echo "No task ID found. Enter task ID (or press enter to skip):"
    read TASK_ID
fi

# Add task ID to commit message if provided
if [ ! -z "$TASK_ID" ]; then
    echo "[$(TASK_ID)] $(cat $1)" > $1
fi
`;

        const hookPath = path.join(this.repoPath, '.git/hooks/prepare-commit-msg');

        try {
            require('fs').writeFileSync(hookPath, hookContent, { mode: 0o755 });
            console.log('✅ Git hook installed successfully');
        } catch (error) {
            console.error('Failed to install git hook:', error);
        }
    }

    /**
     * Create a branch for a task
     */
    async createBranch(taskId) {
        const task = await this.db.getTask(taskId);
        if (!task) throw new Error('Task not found');

        const branchName = this.generateBranchName(task);

        try {
            await execPromise(`git checkout -b ${branchName}`, { cwd: this.repoPath });
            console.log(`✅ Created branch: ${branchName}`);

            // Update task with branch info
            await this.db.addHistory(taskId, 'branch_created', 'system', branchName, 'Git branch created');

            return branchName;
        } catch (error) {
            if (error.message.includes('already exists')) {
                // Checkout existing branch
                await execPromise(`git checkout ${branchName}`, { cwd: this.repoPath });
                console.log(`✅ Switched to existing branch: ${branchName}`);
                return branchName;
            }
            throw error;
        }
    }

    /**
     * Generate branch name from task
     */
    generateBranchName(task) {
        const type = task.level === 'feature' ? 'feature' : task.level === 'bug' ? 'fix' : 'task';
        const title = task.title.toLowerCase()
            .replace(/[^a-z0-9]/g, '-')
            .replace(/-+/g, '-')
            .substr(0, 30);

        return `${type}/${task.id}-${title}`;
    }
}

module.exports = GitIntegration;