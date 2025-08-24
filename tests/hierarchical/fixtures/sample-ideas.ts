import { Idea, ComplexityLevel, Priority } from '../../../src/hierarchical/types';

/**
 * Sample ideas for testing with various complexity levels and domains
 */
export const sampleIdeas: Record<string, Idea> = {
  // Simple ideas
  simpleButton: {
    id: 'simple-button-component',
    title: 'Create Button Component',
    description: 'Design and implement a reusable button component for the UI library',
    complexity: 'simple',
    priority: 'medium',
    tags: ['ui', 'component', 'frontend'],
    metadata: {
      source: 'design-team',
      timestamp: Date.now(),
      estimatedHours: 4
    }
  },

  simpleForm: {
    id: 'simple-contact-form',
    title: 'Contact Form Implementation',
    description: 'Create a contact form with name, email, and message fields',
    complexity: 'simple',
    priority: 'low',
    tags: ['form', 'frontend', 'user-input'],
    metadata: {
      source: 'marketing-team',
      timestamp: Date.now(),
      estimatedHours: 6
    }
  },

  // Medium complexity ideas
  userAuth: {
    id: 'user-authentication-system',
    title: 'User Authentication System',
    description: 'Implement user registration, login, password reset, and session management with JWT tokens',
    complexity: 'medium',
    priority: 'high',
    tags: ['authentication', 'security', 'backend', 'jwt'],
    metadata: {
      source: 'security-team',
      timestamp: Date.now(),
      estimatedHours: 40,
      securityRequirements: true
    }
  },

  blogPlatform: {
    id: 'blog-platform',
    title: 'Blog Publishing Platform',
    description: 'Create a blog platform with post creation, editing, commenting, and user profiles',
    complexity: 'medium',
    priority: 'medium',
    tags: ['blog', 'cms', 'fullstack', 'social'],
    metadata: {
      source: 'content-team',
      timestamp: Date.now(),
      estimatedHours: 80,
      targetAudience: 'content-creators'
    }
  },

  inventoryManagement: {
    id: 'inventory-management',
    title: 'Inventory Management System',
    description: 'Build inventory tracking with product catalog, stock levels, purchase orders, and reporting',
    complexity: 'medium',
    priority: 'high',
    tags: ['inventory', 'business', 'reporting', 'database'],
    metadata: {
      source: 'operations-team',
      timestamp: Date.now(),
      estimatedHours: 120,
      integrations: ['accounting-software', 'suppliers']
    }
  },

  // Complex ideas
  ecommerce: {
    id: 'ecommerce-platform',
    title: 'E-commerce Marketplace Platform',
    description: `Create a comprehensive e-commerce marketplace with:
    - Multi-vendor support and vendor management
    - Product catalog with advanced search and filtering
    - Shopping cart and checkout process
    - Multiple payment gateways integration
    - Order management and tracking
    - Customer reviews and ratings
    - Inventory management across vendors
    - Analytics and reporting dashboard
    - Mobile responsive design
    - Admin panel for marketplace management`,
    complexity: 'complex',
    priority: 'critical',
    tags: ['ecommerce', 'marketplace', 'payments', 'analytics', 'mobile'],
    metadata: {
      source: 'product-team',
      timestamp: Date.now(),
      estimatedHours: 500,
      targetMarket: 'B2B2C',
      revenueModel: 'commission-based'
    }
  },

  healthcareSystem: {
    id: 'healthcare-management-system',
    title: 'Healthcare Management System',
    description: `Develop a comprehensive healthcare management platform including:
    - Patient registration and profile management
    - Appointment scheduling and calendar integration
    - Electronic health records (EHR) system
    - Prescription management and drug interactions
    - Billing and insurance claims processing
    - Telemedicine capabilities with video conferencing
    - Medical imaging viewer and storage
    - Laboratory results integration
    - Compliance with HIPAA and medical standards
    - Multi-location clinic support
    - Reporting and analytics for healthcare metrics`,
    complexity: 'complex',
    priority: 'critical',
    tags: ['healthcare', 'ehr', 'telemedicine', 'compliance', 'billing'],
    metadata: {
      source: 'healthcare-team',
      timestamp: Date.now(),
      estimatedHours: 800,
      complianceRequirements: ['HIPAA', 'HL7', 'FHIR'],
      targetUsers: ['doctors', 'nurses', 'administrators', 'patients']
    }
  },

  fintech: {
    id: 'digital-banking-platform',
    title: 'Digital Banking Platform',
    description: `Build a complete digital banking solution with:
    - Customer onboarding with KYC/AML verification
    - Multiple account types (checking, savings, loans)
    - Real-time transaction processing and notifications
    - Mobile and web banking applications
    - Card management and digital wallets
    - Loan origination and management system
    - Investment portfolio management
    - Fraud detection and prevention
    - Regulatory reporting and compliance
    - Multi-currency support and foreign exchange
    - API integration with banking networks
    - Advanced security with biometric authentication`,
    complexity: 'complex',
    priority: 'critical',
    tags: ['fintech', 'banking', 'payments', 'security', 'compliance', 'mobile'],
    metadata: {
      source: 'fintech-team',
      timestamp: Date.now(),
      estimatedHours: 1200,
      regulatoryRequirements: ['PCI-DSS', 'SOX', 'Basel III'],
      integrations: ['banking-networks', 'payment-processors', 'credit-bureaus']
    }
  },

  // Industry-specific ideas
  manufacturing: {
    id: 'smart-manufacturing-system',
    title: 'Smart Manufacturing System',
    description: 'IoT-enabled manufacturing system with predictive maintenance, quality control, and supply chain integration',
    complexity: 'complex',
    priority: 'high',
    tags: ['manufacturing', 'iot', 'predictive-maintenance', 'supply-chain'],
    metadata: {
      source: 'manufacturing-team',
      timestamp: Date.now(),
      estimatedHours: 600,
      hardwareIntegration: true
    }
  },

  education: {
    id: 'learning-management-system',
    title: 'Learning Management System',
    description: 'Comprehensive LMS with course creation, student tracking, assessments, and virtual classrooms',
    complexity: 'complex',
    priority: 'high',
    tags: ['education', 'lms', 'virtual-classroom', 'assessments'],
    metadata: {
      source: 'education-team',
      timestamp: Date.now(),
      estimatedHours: 400,
      accessibility: true
    }
  },

  // Edge cases for testing
  veryShortDescription: {
    id: 'short-desc-idea',
    title: 'Short Idea',
    description: 'Brief',
    complexity: 'simple',
    priority: 'low',
    tags: ['test'],
    metadata: {
      source: 'test',
      timestamp: Date.now()
    }
  },

  noTags: {
    id: 'no-tags-idea',
    title: 'Idea Without Tags',
    description: 'This idea has no tags to test edge case handling',
    complexity: 'medium',
    priority: 'medium',
    tags: [],
    metadata: {
      source: 'test',
      timestamp: Date.now()
    }
  },

  specialCharacters: {
    id: 'special-chars-idea',
    title: 'Idea with Special Characters: @#$%^&*()',
    description: 'Testing special characters in titles and descriptions: <>{}[]|\\`~!@#$%^&*()_+-=',
    complexity: 'simple',
    priority: 'low',
    tags: ['test', 'special-chars'],
    metadata: {
      source: 'qa-team',
      timestamp: Date.now(),
      testCase: 'special-characters'
    }
  },

  multiLanguage: {
    id: 'multi-language-idea',
    title: 'Multi-Language Content Management',
    description: 'Système de gestion de contenu multilingue - Sistema de gestión de contenido multiidioma - 多言語コンテンツ管理システム',
    complexity: 'medium',
    priority: 'medium',
    tags: ['i18n', 'multilingual', 'cms'],
    metadata: {
      source: 'international-team',
      timestamp: Date.now(),
      languages: ['en', 'fr', 'es', 'ja']
    }
  }
};

/**
 * Generate ideas with different complexity distributions
 */
export function generateIdeasByComplexity(count: number, complexity: ComplexityLevel): Idea[] {
  const baseIdeas = Object.values(sampleIdeas).filter(idea => idea.complexity === complexity);
  const ideas: Idea[] = [];
  
  for (let i = 0; i < count; i++) {
    const baseIdea = baseIdeas[i % baseIdeas.length];
    ideas.push({
      ...baseIdea,
      id: `${complexity}-idea-${i}`,
      title: `${baseIdea.title} ${i + 1}`,
      metadata: {
        ...baseIdea.metadata,
        generated: true,
        index: i
      }
    });
  }
  
  return ideas;
}

/**
 * Generate ideas with different priorities
 */
export function generateIdeasByPriority(count: number, priority: Priority): Idea[] {
  const baseIdeas = Object.values(sampleIdeas).filter(idea => idea.priority === priority);
  const ideas: Idea[] = [];
  
  for (let i = 0; i < count; i++) {
    const baseIdea = baseIdeas[i % baseIdeas.length];
    ideas.push({
      ...baseIdea,
      id: `${priority}-priority-idea-${i}`,
      title: `${baseIdea.title} (Priority ${priority}) ${i + 1}`,
      priority,
      metadata: {
        ...baseIdea.metadata,
        generated: true,
        priorityTest: true,
        index: i
      }
    });
  }
  
  return ideas;
}

/**
 * Generate large batch of ideas for performance testing
 */
export function generateLargeBatchIdeas(count: number): Idea[] {
  const complexities: ComplexityLevel[] = ['simple', 'medium', 'complex'];
  const priorities: Priority[] = ['low', 'medium', 'high', 'critical'];
  const domains = ['fintech', 'healthcare', 'ecommerce', 'education', 'manufacturing'];
  const ideas: Idea[] = [];
  
  for (let i = 0; i < count; i++) {
    const complexity = complexities[i % complexities.length];
    const priority = priorities[i % priorities.length];
    const domain = domains[i % domains.length];
    
    ideas.push({
      id: `batch-idea-${i}`,
      title: `${domain.charAt(0).toUpperCase() + domain.slice(1)} Solution ${i + 1}`,
      description: `This is a ${complexity} ${domain} solution for batch testing. It includes multiple requirements and features to simulate real-world scenarios. Index: ${i}`,
      complexity,
      priority,
      tags: [domain, complexity, 'batch-test'],
      metadata: {
        source: 'batch-generator',
        timestamp: Date.now() + i,
        batchIndex: i,
        domain,
        generated: true
      }
    });
  }
  
  return ideas;
}

/**
 * Get ideas for specific test scenarios
 */
export const testScenarios = {
  validationTesting: [
    sampleIdeas.veryShortDescription,
    sampleIdeas.noTags,
    sampleIdeas.specialCharacters
  ],
  
  complexityTesting: [
    sampleIdeas.simpleButton,
    sampleIdeas.userAuth,
    sampleIdeas.ecommerce
  ],
  
  domainTesting: [
    sampleIdeas.fintech,
    sampleIdeas.healthcareSystem,
    sampleIdeas.manufacturing,
    sampleIdeas.education
  ],
  
  performanceTesting: generateLargeBatchIdeas(100),
  
  i18nTesting: [
    sampleIdeas.multiLanguage
  ]
};

export default sampleIdeas;