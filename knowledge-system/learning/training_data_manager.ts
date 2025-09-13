
export class TrainingDataManager {
  private datasets: Map<string, any[]>;
  private readonly MIN_TRAINING_SIZE = 1000;

  constructor() {
    this.datasets = new Map();
    this.loadPretrainedData();
  }

  private async loadPretrainedData() {
    // Load requirement classification training data
    this.datasets.set('requirements', [
      // Functional requirements
      { text: 'User should be able to login with email and password', label: 'functional', confidence: 0.95 },
      { text: 'System must validate user credentials against database', label: 'functional', confidence: 0.93 },
      { text: 'Application should send email notifications for new messages', label: 'functional', confidence: 0.91 },
      { text: 'Users can upload profile pictures up to 5MB', label: 'functional', confidence: 0.89 },
      { text: 'Admin can view all user activities in dashboard', label: 'functional', confidence: 0.92 },
      { text: 'System generates monthly reports automatically', label: 'functional', confidence: 0.90 },
      { text: 'Users can filter search results by date range', label: 'functional', confidence: 0.88 },
      { text: 'Application exports data in CSV and PDF formats', label: 'functional', confidence: 0.91 },

      // Non-functional requirements
      { text: 'Response time should be under 200ms', label: 'non-functional', confidence: 0.94 },
      { text: 'System must handle 10000 concurrent users', label: 'non-functional', confidence: 0.96 },
      { text: 'Application should be available 99.9% of the time', label: 'non-functional', confidence: 0.95 },
      { text: 'All data must be encrypted using AES-256', label: 'non-functional', confidence: 0.97 },
      { text: 'Platform should support mobile and desktop browsers', label: 'non-functional', confidence: 0.89 },
      { text: 'Database backups must occur every 6 hours', label: 'non-functional', confidence: 0.92 },
      { text: 'System should scale horizontally', label: 'non-functional', confidence: 0.90 },
      { text: 'Application must comply with GDPR regulations', label: 'non-functional', confidence: 0.94 },

      // Add 980+ more examples loaded from external dataset
      ...await this.loadExternalDataset('requirements')
    ]);

    // Load sprint prioritization training data
    this.datasets.set('prioritization', [
      {
        item: 'Fix critical security vulnerability',
        features: { businessValue: 10, risk: 10, effort: 3, urgency: 10 },
        priority: 'critical'
      },
      {
        item: 'Add dark mode feature',
        features: { businessValue: 5, risk: 2, effort: 5, urgency: 3 },
        priority: 'medium'
      },
      {
        item: 'Optimize database queries',
        features: { businessValue: 7, risk: 4, effort: 6, urgency: 6 },
        priority: 'high'
      },
      // Add more examples
      ...await this.loadExternalDataset('prioritization')
    ]);

    // Load acceptance criteria patterns
    this.datasets.set('acceptance_criteria', [
      {
        feature: 'user authentication',
        criteria: [
          'Given valid credentials, when user logs in, then redirect to dashboard',
          'Given invalid password, when user logs in, then show error message',
          'Given locked account, when user logs in, then show account locked message'
        ]
      },
      {
        feature: 'shopping cart',
        criteria: [
          'Given items in cart, when user clicks checkout, then show payment page',
          'Given empty cart, when user clicks checkout, then show empty cart message',
          'Given expired session, when user returns, then restore cart items'
        ]
      },
      // Add more examples
      ...await this.loadExternalDataset('acceptance_criteria')
    ]);
  }

  private async loadExternalDataset(type: string): Promise<any[]> {
    try {
      // In production, load from S3, database, or API
      const response = await fetch(`https://api.training-data.com/${type}`);
      return await response.json();
    } catch (error) {
      console.log(`Using synthetic data for ${type}`);
      return this.generateSyntheticData(type, this.MIN_TRAINING_SIZE);
    }
  }

  private generateSyntheticData(type: string, count: number): any[] {
    const synthetic = [];
    const templates = this.getTemplates(type);

    for (let i = 0; i < count; i++) {
      const template = templates[i % templates.length];
      synthetic.push(this.fillTemplate(template, i));
    }

    return synthetic;
  }

  private getTemplates(type: string): any[] {
    const templates = {
      requirements: [
        'User can {action} {object}',
        'System must {requirement}',
        'Application should {capability}',
        'Performance must be {metric}',
        'Security requires {protection}'
      ],
      prioritization: [
        '{feature} for {user_type}',
        'Fix {issue_type} in {component}',
        'Optimize {process} performance',
        'Add {capability} to {module}'
      ],
      acceptance_criteria: [
        'Given {context}, when {action}, then {result}',
        'As a {user}, I want {feature}, so that {benefit}',
        'Verify that {condition} results in {outcome}'
      ]
    };

    return templates[type] || [];
  }

  private fillTemplate(template: string, index: number): any {
    // Template filling logic
    const variables = {
      action: ['create', 'update', 'delete', 'view', 'export'],
      object: ['profile', 'document', 'report', 'user', 'data'],
      requirement: ['encrypt data', 'validate input', 'log actions', 'handle errors'],
      capability: ['support offline mode', 'enable notifications', 'allow customization'],
      metric: ['under 100ms', 'above 99%', 'less than 1%', 'within 2 seconds'],
      protection: ['two-factor auth', 'SSL/TLS', 'input sanitization', 'rate limiting']
    };

    let filled = template;
    for (const [key, values] of Object.entries(variables)) {
      const pattern = new RegExp(`{{${key}}}`, 'g');
      filled = filled.replace(pattern, values[index % values.length]);
    }

    return {
      text: filled,
      label: this.inferLabel(filled),
      confidence: 0.8 + Math.random() * 0.2
    };
  }

  private inferLabel(text: string): string {
    if (text.includes('must') || text.includes('should')) {
      return text.includes('performance') || text.includes('security')
        ? 'non-functional'
        : 'functional';
    }
    return 'unknown';
  }

  public getTrainingData(type: string): any[] {
    return this.datasets.get(type) || [];
  }

  public addTrainingExample(type: string, example: any): void {
    if (!this.datasets.has(type)) {
      this.datasets.set(type, []);
    }
    this.datasets.get(type).push(example);
  }

  public async augmentData(type: string, augmentationFactor: number = 2): Promise<void> {
    const original = this.datasets.get(type) || [];
    const augmented = [];

    for (const item of original) {
      for (let i = 0; i < augmentationFactor; i++) {
        augmented.push(this.augmentExample(item));
      }
    }

    this.datasets.set(type, [...original, ...augmented]);
  }

  private augmentExample(example: any): any {
    // Apply various augmentation techniques
    const techniques = [
      this.synonymReplacement,
      this.randomInsertion,
      this.randomSwap,
      this.paraphrase
    ];

    const technique = techniques[Math.floor(Math.random() * techniques.length)];
    return technique.call(this, example);
  }

  private synonymReplacement(example: any): any {
    // Replace words with synonyms
    const synonyms = {
      'user': ['customer', 'client', 'member'],
      'create': ['generate', 'make', 'produce'],
      'delete': ['remove', 'erase', 'clear'],
      'fast': ['quick', 'rapid', 'speedy']
    };

    let text = example.text || example;
    for (const [word, syns] of Object.entries(synonyms)) {
      if (text.includes(word)) {
        text = text.replace(word, syns[Math.floor(Math.random() * syns.length)]);
      }
    }

    return { ...example, text, augmented: true };
  }

  private randomInsertion(example: any): any {
    // Insert random relevant words
    const insertions = ['importantly', 'specifically', 'particularly', 'essentially'];
    let text = example.text || example;
    const words = text.split(' ');
    const position = Math.floor(Math.random() * words.length);
    words.splice(position, 0, insertions[Math.floor(Math.random() * insertions.length)]);

    return { ...example, text: words.join(' '), augmented: true };
  }

  private randomSwap(example: any): any {
    // Swap two words randomly
    let text = example.text || example;
    const words = text.split(' ');
    if (words.length > 3) {
      const i = Math.floor(Math.random() * (words.length - 1));
      const j = Math.floor(Math.random() * (words.length - 1));
      [words[i], words[j]] = [words[j], words[i]];
    }

    return { ...example, text: words.join(' '), augmented: true };
  }

  private paraphrase(example: any): any {
    // Simple paraphrasing
    const paraphrases = {
      'should be able to': 'can',
      'must be': 'needs to be',
      'is required to': 'must'
    };

    let text = example.text || example;
    for (const [original, replacement] of Object.entries(paraphrases)) {
      text = text.replace(original, replacement);
    }

    return { ...example, text, augmented: true };
  }
}
