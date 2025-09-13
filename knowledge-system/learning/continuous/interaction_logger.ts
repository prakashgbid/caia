
import sqlite3 from 'sqlite3';
import { EventEmitter } from 'events';
import crypto from 'crypto';

export class InteractionLogger extends EventEmitter {
  private db: any;
  private patternThreshold: number = 3;
  private patterns: Map<string, any>;

  constructor(dbPath: string = './learning_interactions.db') {
    super();
    this.patterns = new Map();
    this.initDatabase(dbPath);
  }

  private async initDatabase(dbPath: string) {
    this.db = new sqlite3.Database(dbPath);

    await this.runQuery(`
      CREATE TABLE IF NOT EXISTS interactions (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        type TEXT,
        content TEXT,
        metadata TEXT,
        patterns TEXT,
        user_feedback INTEGER
      )
    `);

    await this.runQuery(`
      CREATE TABLE IF NOT EXISTS patterns (
        id TEXT PRIMARY KEY,
        pattern TEXT,
        frequency INTEGER DEFAULT 1,
        confidence REAL,
        last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
        metadata TEXT
      )
    `);

    await this.runQuery(`
      CREATE TABLE IF NOT EXISTS user_model (
        id TEXT PRIMARY KEY,
        attribute TEXT,
        value TEXT,
        confidence REAL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  private runQuery(query: string, params?: any[]): Promise<any> {
    return new Promise((resolve, reject) => {
      this.db.all(query, params || [], (err: any, rows: any) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  async logInteraction(interaction: any) {
    const id = crypto.randomBytes(16).toString('hex');

    // Store raw interaction
    await this.runQuery(
      `INSERT INTO interactions (id, session_id, type, content, metadata)
       VALUES (?, ?, ?, ?, ?)`,
      [
        id,
        interaction.sessionId,
        interaction.type,
        JSON.stringify(interaction.content),
        JSON.stringify(interaction.metadata || {})
      ]
    );

    // Extract patterns
    const patterns = await this.detectPatterns(interaction);

    if (patterns.length > 0) {
      // Update pattern database
      for (const pattern of patterns) {
        await this.updatePattern(pattern);
      }

      // Update interaction with patterns
      await this.runQuery(
        `UPDATE interactions SET patterns = ? WHERE id = ?`,
        [JSON.stringify(patterns), id]
      );

      // Update user model
      await this.updateUserModel(patterns);

      // Check if should trigger learning
      if (this.shouldTriggerLearning(patterns)) {
        this.emit('learning-triggered', { patterns, interaction });
      }
    }

    return { id, patterns };
  }

  private async detectPatterns(interaction: any) {
    const patterns = [];

    // Command patterns
    if (interaction.type === 'command') {
      const cmdPattern = this.extractCommandPattern(interaction.content);
      if (cmdPattern) patterns.push(cmdPattern);
    }

    // Navigation patterns
    if (interaction.type === 'navigation') {
      const navPattern = this.extractNavigationPattern(interaction.content);
      if (navPattern) patterns.push(navPattern);
    }

    // Error patterns
    if (interaction.type === 'error') {
      const errorPattern = this.extractErrorPattern(interaction.content);
      if (errorPattern) patterns.push(errorPattern);
    }

    // Preference patterns
    const prefPattern = this.extractPreferencePattern(interaction);
    if (prefPattern) patterns.push(prefPattern);

    return patterns;
  }

  private extractCommandPattern(content: any) {
    const commands = content.command?.split(' ') || [];
    if (commands.length > 0) {
      return {
        type: 'command',
        pattern: commands[0],
        context: commands.slice(1).join(' '),
        timestamp: new Date()
      };
    }
    return null;
  }

  private extractNavigationPattern(content: any) {
    if (content.from && content.to) {
      return {
        type: 'navigation',
        pattern: `${content.from} -> ${content.to}`,
        context: content.trigger,
        timestamp: new Date()
      };
    }
    return null;
  }

  private extractErrorPattern(content: any) {
    if (content.error) {
      return {
        type: 'error',
        pattern: content.error.code || 'unknown',
        context: content.error.message,
        timestamp: new Date()
      };
    }
    return null;
  }

  private extractPreferencePattern(interaction: any) {
    // Detect preferences from choices
    if (interaction.content.choice) {
      return {
        type: 'preference',
        pattern: interaction.content.choice,
        context: interaction.type,
        timestamp: new Date()
      };
    }
    return null;
  }

  private async updatePattern(pattern: any) {
    const existing = await this.runQuery(
      `SELECT * FROM patterns WHERE pattern = ? AND type = ?`,
      [pattern.pattern, pattern.type]
    );

    if (existing.length > 0) {
      await this.runQuery(
        `UPDATE patterns
         SET frequency = frequency + 1,
             last_seen = CURRENT_TIMESTAMP,
             confidence = MIN(1.0, confidence + 0.1)
         WHERE pattern = ? AND type = ?`,
        [pattern.pattern, pattern.type]
      );
    } else {
      const id = crypto.randomBytes(16).toString('hex');
      await this.runQuery(
        `INSERT INTO patterns (id, pattern, type, confidence, metadata)
         VALUES (?, ?, ?, ?, ?)`,
        [id, pattern.pattern, pattern.type, 0.5, JSON.stringify(pattern)]
      );
    }
  }

  private async updateUserModel(patterns: any[]) {
    for (const pattern of patterns) {
      const attribute = `${pattern.type}_preference`;

      const existing = await this.runQuery(
        `SELECT * FROM user_model WHERE attribute = ?`,
        [attribute]
      );

      if (existing.length > 0) {
        await this.runQuery(
          `UPDATE user_model
           SET value = ?, confidence = MIN(1.0, confidence + 0.05), updated_at = CURRENT_TIMESTAMP
           WHERE attribute = ?`,
          [pattern.pattern, attribute]
        );
      } else {
        const id = crypto.randomBytes(16).toString('hex');
        await this.runQuery(
          `INSERT INTO user_model (id, attribute, value, confidence)
           VALUES (?, ?, ?, ?)`,
          [id, attribute, pattern.pattern, 0.5]
        );
      }
    }
  }

  private shouldTriggerLearning(patterns: any[]) {
    // Trigger learning if we have enough high-confidence patterns
    const highConfidence = patterns.filter(p => p.confidence > 0.7);
    return highConfidence.length >= this.patternThreshold;
  }

  async analyzeSession(sessionId: string) {
    const interactions = await this.runQuery(
      `SELECT * FROM interactions WHERE session_id = ? ORDER BY timestamp`,
      [sessionId]
    );

    const summary = {
      sessionId,
      totalInteractions: interactions.length,
      interactionTypes: {},
      patterns: [],
      insights: []
    };

    // Count interaction types
    for (const interaction of interactions) {
      const type = interaction.type;
      summary.interactionTypes[type] = (summary.interactionTypes[type] || 0) + 1;
    }

    // Extract common patterns
    const patternCounts = {};
    for (const interaction of interactions) {
      if (interaction.patterns) {
        const patterns = JSON.parse(interaction.patterns);
        for (const pattern of patterns) {
          const key = `${pattern.type}:${pattern.pattern}`;
          patternCounts[key] = (patternCounts[key] || 0) + 1;
        }
      }
    }

    // Find most common patterns
    summary.patterns = Object.entries(patternCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([pattern, count]) => ({ pattern, count }));

    // Generate insights
    if (summary.interactionTypes['error'] > interactions.length * 0.3) {
      summary.insights.push('High error rate detected - user may need assistance');
    }

    if (summary.patterns.length > 0) {
      summary.insights.push(`User shows consistent patterns: ${summary.patterns[0].pattern}`);
    }

    return summary;
  }

  async getUserModel() {
    const model = await this.runQuery(`SELECT * FROM user_model ORDER BY confidence DESC`);
    return model;
  }

  async getPatternStats() {
    const stats = await this.runQuery(`
      SELECT type, COUNT(*) as count, AVG(confidence) as avg_confidence
      FROM patterns
      GROUP BY type
    `);
    return stats;
  }
}
