
import { BusinessAnalystBridge } from './bridge';
import * as natural from 'natural';

export class BusinessAnalystImplementation extends BusinessAnalystBridge {
  private classifier: any;
  private tokenizer: any;

  constructor(config: any) {
    super(config);
    this.tokenizer = new natural.WordTokenizer();
    this.classifier = new natural.BayesClassifier();
    this.trainClassifier();
  }

  private trainClassifier() {
    // Train for requirement classification
    this.classifier.addDocument('user login authentication', 'functional');
    this.classifier.addDocument('response time performance', 'non-functional');
    this.classifier.addDocument('data encryption security', 'non-functional');
    this.classifier.addDocument('create update delete', 'functional');
    this.classifier.addDocument('scalability reliability', 'non-functional');
    this.classifier.train();
  }

  async extractRequirements(idea: any) {
    const tokens = this.tokenizer.tokenize(idea.description);
    const sentences = idea.description.split(/[.!?]+/);

    const requirements = {
      functionalRequirements: [],
      nonFunctionalRequirements: [],
      businessRules: [],
      assumptions: [],
      constraints: [],
      stakeholderNeeds: new Map(),
      prioritizedRequirements: []
    };

    // Classify each sentence
    for (const sentence of sentences) {
      if (sentence.trim()) {
        const classification = this.classifier.classify(sentence);

        if (classification === 'functional') {
          requirements.functionalRequirements.push(sentence.trim());
        } else {
          requirements.nonFunctionalRequirements.push(sentence.trim());
        }
      }
    }

    // Extract business rules
    requirements.businessRules = this.extractBusinessRules(sentences);

    // Identify stakeholders
    requirements.stakeholderNeeds = this.identifyStakeholders(idea.description);

    // Prioritize requirements
    requirements.prioritizedRequirements = this.prioritizeRequirements([
      ...requirements.functionalRequirements,
      ...requirements.nonFunctionalRequirements
    ]);

    return requirements;
  }

  private extractBusinessRules(sentences: string[]) {
    const rules = [];
    const rulePatterns = [
      /musts+w+/gi,
      /shoulds+w+/gi,
      /requireds+tos+w+/gi,
      /needs?s+tos+w+/gi
    ];

    for (const sentence of sentences) {
      for (const pattern of rulePatterns) {
        if (pattern.test(sentence)) {
          rules.push(sentence.trim());
          break;
        }
      }
    }

    return rules;
  }

  private identifyStakeholders(description: string) {
    const stakeholders = new Map();
    const roles = ['user', 'admin', 'customer', 'manager', 'developer', 'owner'];

    for (const role of roles) {
      const regex = new RegExp(`${role}s?`, 'gi');
      if (regex.test(description)) {
        stakeholders.set(role, []);
      }
    }

    return stakeholders;
  }

  private prioritizeRequirements(requirements: string[]) {
    return requirements.map(req => {
      let priority = 'medium';
      let rationale = 'Standard requirement';

      if (/critical|essential|must/i.test(req)) {
        priority = 'critical';
        rationale = 'Contains critical keywords';
      } else if (/important|should/i.test(req)) {
        priority = 'high';
        rationale = 'Contains importance indicators';
      } else if (/nice|could|optional/i.test(req)) {
        priority = 'low';
        rationale = 'Optional feature';
      }

      return { requirement: req, priority, rationale };
    });
  }

  async generateAcceptanceCriteria(feature: any) {
    const criteria = [];
    const scenarios = this.generateScenarios(feature);

    for (const scenario of scenarios) {
      criteria.push({
        id: `AC-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        story: scenario.story,
        criterion: scenario.criterion,
        testable: true,
        priority: 'must',
        validationMethod: 'automated_test'
      });
    }

    return {
      criteria,
      definitionOfDone: [
        'All acceptance criteria met',
        'Code reviewed and approved',
        'Unit tests written and passing',
        'Documentation updated',
        'No critical bugs'
      ],
      qualityGates: [
        'Code coverage > 80%',
        'All tests passing',
        'No security vulnerabilities',
        'Performance benchmarks met'
      ],
      testingStrategy: [
        'Unit testing for all components',
        'Integration testing for workflows',
        'End-to-end testing for user journeys',
        'Performance testing for critical paths'
      ]
    };
  }

  private generateScenarios(feature: any) {
    const scenarios = [];

    // Generate basic CRUD scenarios if applicable
    const crudOperations = ['Create', 'Read', 'Update', 'Delete'];

    for (const op of crudOperations) {
      scenarios.push({
        story: `As a user, I want to ${op.toLowerCase()} ${feature.name}`,
        criterion: `Given valid input, when ${op} operation is performed, then the system should successfully ${op.toLowerCase()} the ${feature.name}`
      });
    }

    return scenarios;
  }
}
