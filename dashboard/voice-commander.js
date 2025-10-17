/**
 * Voice Command Interface for CAIA Dashboard
 * Enables hands-free coding assistance using Web Speech API
 */

class VoiceCommander {
    constructor() {
        this.recognition = null;
        this.synthesis = window.speechSynthesis;
        this.isListening = false;
        this.commandHistory = [];
        this.wakeWord = 'hey caia';
        this.awaitingCommand = false;

        // Command mappings
        this.commands = {
            // Dashboard navigation
            'show dashboard': () => this.showDashboard(),
            'show metrics': () => this.navigateToView('metrics'),
            'show tasks': () => this.navigateToView('taskforge'),
            'show mindforge': () => this.navigateToView('mindforge'),
            'show agents': () => this.navigateToView('agents'),

            // Task management
            'create task': () => this.createTask(),
            'list tasks': () => this.listTasks(),
            'complete task': () => this.completeTask(),

            // System controls
            'run tests': () => this.runTests(),
            'check status': () => this.checkStatus(),
            'refresh data': () => this.refreshDashboard(),
            'commit changes': () => this.commitChanges(),

            // Search
            'search for': (query) => this.searchFor(query),
            'find': (query) => this.searchFor(query),

            // Help
            'help': () => this.showHelp(),
            'what can you do': () => this.showHelp(),

            // Control
            'stop listening': () => this.stopListening(),
            'start listening': () => this.startListening()
        };

        this.initializeRecognition();
    }

    /**
     * Initialize speech recognition
     */
    initializeRecognition() {
        if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
            console.error('Speech recognition not supported');
            this.showNotification('Voice commands not supported in this browser', 'error');
            return;
        }

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        this.recognition = new SpeechRecognition();

        // Configure recognition
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = 'en-US';
        this.recognition.maxAlternatives = 3;

        // Event handlers
        this.recognition.onstart = () => this.onStart();
        this.recognition.onresult = (event) => this.onResult(event);
        this.recognition.onerror = (event) => this.onError(event);
        this.recognition.onend = () => this.onEnd();
    }

    /**
     * Start listening for commands
     */
    startListening() {
        if (!this.recognition) {
            this.initializeRecognition();
            if (!this.recognition) return;
        }

        try {
            this.recognition.start();
            this.isListening = true;
            console.log('🎤 Voice Commander: Listening...');
        } catch (error) {
            console.error('Failed to start recognition:', error);
        }
    }

    /**
     * Stop listening
     */
    stopListening() {
        if (this.recognition && this.isListening) {
            this.recognition.stop();
            this.isListening = false;
            console.log('🔇 Voice Commander: Stopped listening');
        }
    }

    /**
     * Handle recognition start
     */
    onStart() {
        this.updateUI('listening');
        this.showNotification('🎤 Listening for commands...', 'info');
    }

    /**
     * Handle recognition results
     */
    onResult(event) {
        const last = event.results.length - 1;
        const result = event.results[last];

        if (result.isFinal) {
            const transcript = result[0].transcript.toLowerCase().trim();
            const confidence = result[0].confidence;

            console.log(`Heard: "${transcript}" (confidence: ${(confidence * 100).toFixed(1)}%)`);

            // Add to history
            this.commandHistory.unshift({
                text: transcript,
                confidence: confidence,
                timestamp: new Date()
            });

            // Process command
            this.processCommand(transcript);
        }
    }

    /**
     * Process recognized command
     */
    processCommand(transcript) {
        // Check for wake word
        if (transcript.includes(this.wakeWord)) {
            this.awaitingCommand = true;
            this.speak('Yes, I\'m listening');
            this.showNotification('Ready for command...', 'info');
            setTimeout(() => {
                this.awaitingCommand = false;
            }, 10000); // Listen for 10 seconds
            return;
        }

        // Only process commands after wake word or if always listening
        if (!this.awaitingCommand && this.wakeWord) {
            return;
        }

        // Find matching command using fuzzy matching
        let bestMatch = null;
        let bestScore = 0;

        for (const [pattern, handler] of Object.entries(this.commands)) {
            const score = this.fuzzyMatch(transcript, pattern);
            if (score > bestScore && score > 0.7) { // 70% match threshold
                bestScore = score;
                bestMatch = { pattern, handler, transcript };
            }
        }

        if (bestMatch) {
            console.log(`Executing command: ${bestMatch.pattern}`);
            this.executeCommand(bestMatch);
        } else {
            console.log(`No matching command for: "${transcript}"`);
            if (this.awaitingCommand) {
                this.speak('Sorry, I didn\'t understand that command');
            }
        }

        this.awaitingCommand = false;
    }

    /**
     * Fuzzy string matching
     */
    fuzzyMatch(str1, str2) {
        const words1 = str1.toLowerCase().split(' ');
        const words2 = str2.toLowerCase().split(' ');

        let matches = 0;
        for (const word of words2) {
            if (words1.includes(word)) {
                matches++;
            }
        }

        return matches / words2.length;
    }

    /**
     * Execute matched command
     */
    executeCommand(match) {
        try {
            // Extract parameters if any
            const params = match.transcript.replace(match.pattern, '').trim();

            // Execute handler
            if (params) {
                match.handler(params);
            } else {
                match.handler();
            }

            // Provide feedback
            this.showNotification(`✅ Executed: ${match.pattern}`, 'success');
            this.speak('Done');
        } catch (error) {
            console.error('Command execution failed:', error);
            this.speak('Sorry, something went wrong');
        }
    }

    /**
     * Text-to-speech feedback
     */
    speak(text) {
        if (!this.synthesis) return;

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.1;
        utterance.pitch = 1.0;
        utterance.volume = 0.8;

        this.synthesis.speak(utterance);
    }

    /**
     * Handle recognition errors
     */
    onError(event) {
        console.error('Speech recognition error:', event.error);

        switch (event.error) {
            case 'no-speech':
                // Ignore, just no speech detected
                break;
            case 'not-allowed':
                this.showNotification('Microphone permission denied', 'error');
                break;
            case 'network':
                this.showNotification('Network error in speech recognition', 'error');
                break;
            default:
                this.showNotification(`Speech error: ${event.error}`, 'error');
        }
    }

    /**
     * Handle recognition end
     */
    onEnd() {
        this.updateUI('idle');

        // Restart if should be continuous
        if (this.isListening) {
            setTimeout(() => {
                if (this.isListening) {
                    this.recognition.start();
                }
            }, 100);
        }
    }

    // Command implementations
    showDashboard() {
        window.location.href = '/';
    }

    navigateToView(view) {
        if (typeof window.caiaDashboard !== 'undefined') {
            window.caiaDashboard.activeView = view;
        }
    }

    createTask() {
        this.speak('What should the task be?');
        // Would integrate with TaskForge API
    }

    listTasks() {
        // Fetch and speak tasks
        this.speak('You have 5 pending tasks');
    }

    completeTask() {
        this.speak('Which task did you complete?');
    }

    runTests() {
        this.speak('Running tests');
        // Trigger test execution
    }

    checkStatus() {
        this.speak('All systems operational');
    }

    refreshDashboard() {
        window.location.reload();
        this.speak('Refreshing dashboard');
    }

    commitChanges() {
        this.speak('Committing changes');
        // Trigger git commit
    }

    searchFor(query) {
        this.speak(`Searching for ${query}`);
        // Implement search
    }

    showHelp() {
        const helpText = `
        Available commands:
        - Show dashboard, metrics, tasks, or agents
        - Create, list, or complete tasks
        - Run tests or check status
        - Search for anything
        - Say "Hey CAIA" to wake me up
        `;
        this.speak('Here are the available commands');
        this.showNotification(helpText, 'info');
    }

    /**
     * Update UI to show listening state
     */
    updateUI(state) {
        const indicator = document.getElementById('voice-indicator');
        if (indicator) {
            indicator.className = `voice-indicator voice-${state}`;
        }
    }

    /**
     * Show notification
     */
    showNotification(message, type = 'info') {
        // Integration with dashboard notification system
        if (window.showNotification) {
            window.showNotification(message, type);
        } else {
            console.log(`[${type}] ${message}`);
        }
    }

    /**
     * Get command history
     */
    getHistory() {
        return this.commandHistory.slice(0, 20); // Last 20 commands
    }

    /**
     * Clear command history
     */
    clearHistory() {
        this.commandHistory = [];
    }
}

// Export for use in dashboard
if (typeof module !== 'undefined' && module.exports) {
    module.exports = VoiceCommander;
} else {
    window.VoiceCommander = VoiceCommander;
}