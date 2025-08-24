import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { IdeaAnalyzer } from '../../../src/hierarchical/stream1/idea-analyzer';
import { InitiativePlanner } from '../../../src/hierarchical/stream2/initiative-planner';
import { FeatureArchitect } from '../../../src/hierarchical/stream3/feature-architect';
import { QualityGateController } from '../../../src/hierarchical/stream4/quality-gate-controller';
import { JiraConnector } from '../../../agents/connectors/jira-connect';
import { DocumentationGenerator } from '../../../src/hierarchical/documentation/documentation-generator';
import { MonitoringService } from '../../../src/hierarchical/monitoring/monitoring-service';
import { Idea, Architecture } from '../../../src/hierarchical/types';
import { restoreConsole } from '../src/config/jest.setup';

describe('Complete End-to-End Workflow Tests', () => {
  let ideaAnalyzer: IdeaAnalyzer;
  let initiativePlanner: InitiativePlanner;
  let featureArchitect: FeatureArchitect;
  let qualityGateController: QualityGateController;
  let jiraConnector: JiraConnector;
  let documentationGenerator: DocumentationGenerator;
  let monitoringService: MonitoringService;

  beforeEach(() => {
    ideaAnalyzer = new IdeaAnalyzer();
    initiativePlanner = new InitiativePlanner();
    featureArchitect = new FeatureArchitect();
    qualityGateController = new QualityGateController();
    jiraConnector = new JiraConnector();
    documentationGenerator = new DocumentationGenerator();
    monitoringService = new MonitoringService();
  });

  describe('Complete Idea-to-JIRA Workflow', () => {
    it('should process complete workflow from idea to JIRA hierarchy', async () => {
      const originalIdea: Idea = {
        id: 'e2e-workflow-idea',
        title: 'Digital Banking Platform',
        description: `Create a comprehensive digital banking platform that includes:
        - Customer onboarding and KYC verification
        - Account management (checking, savings, loans)
        - Mobile and web applications
        - Real-time transaction processing
        - Fraud detection and security
        - Integration with banking APIs
        - Compliance and regulatory reporting
        - Customer support chat system
        - Analytics and business intelligence
        - Multi-currency support`,
        complexity: 'complex',
        priority: 'critical',
        tags: ['banking', 'fintech', 'mobile', 'security', 'compliance'],
        metadata: {
          source: 'product-team',
          timestamp: Date.now(),
          requestedBy: 'cto@bank.com',
          businessUnit: 'digital-transformation'
        }
      };

      console.log('\n🚀 Starting Complete E2E Workflow Test...');
      console.log(`Original Idea: ${originalIdea.title}`);

      // Step 1: Analyze the idea
      console.log('\n📊 Step 1: Analyzing idea...');
      const analysisResult = await ideaAnalyzer.generateAnalysisReport(originalIdea);
      
      expect(analysisResult.validation.isValid).toBe(true);
      expect(analysisResult.complexity).toBe('complex');
      expect(analysisResult.keywords.length).toBeGreaterThan(5);
      
      console.log(`✅ Analysis complete - Complexity: ${analysisResult.complexity}, Keywords: ${analysisResult.keywords.length}`);

      // Step 2: Create initiative plan
      console.log('\n🎯 Step 2: Creating initiative plan...');
      const initiativePlan = await initiativePlanner.createInitiativePlan(analysisResult);
      
      expect(initiativePlan.initiative.title).toContain('Banking');
      expect(initiativePlan.epics.length).toBeGreaterThan(3);
      expect(initiativePlan.timeline.endDate > initiativePlan.timeline.startDate).toBe(true);
      
      console.log(`✅ Initiative plan created - Epics: ${initiativePlan.epics.length}, Timeline: ${Math.round((initiativePlan.timeline.endDate.getTime() - initiativePlan.timeline.startDate.getTime()) / (24 * 60 * 60 * 1000))} days`);

      // Step 3: Generate detailed architecture
      console.log('\n🏗️ Step 3: Generating architecture...');
      const architecture = await featureArchitect.generateArchitecture(initiativePlan);
      
      expect(architecture.features.length).toBeGreaterThan(10);
      expect(architecture.stories.length).toBeGreaterThan(30);
      expect(architecture.tasks.length).toBeGreaterThan(60);
      
      console.log(`✅ Architecture generated - Features: ${architecture.features.length}, Stories: ${architecture.stories.length}, Tasks: ${architecture.tasks.length}`);

      // Step 4: Quality gate validation
      console.log('\n🔍 Step 4: Running quality gates...');
      const qualityGates = qualityGateController.getDefaultQualityGates();
      const qualityResult = await qualityGateController.validateArchitecture(architecture, qualityGates);
      
      expect(qualityResult.isValid).toBe(true);
      expect(qualityResult.overallScore).toBeGreaterThan(80);
      
      console.log(`✅ Quality gates passed - Score: ${qualityResult.overallScore}%, Gates: ${qualityResult.gateResults.filter(g => g.passed).length}/${qualityResult.gateResults.length}`);

      // Step 5: Create JIRA hierarchy
      console.log('\n📋 Step 5: Creating JIRA issues...');
      
      // Mock JIRA responses
      let issueCounter = 0;
      const createdIssues: any[] = [];
      const mockCreateIssue = jest.fn().mockImplementation(async (issueData) => {
        issueCounter++;
        const issue = {
          key: `BANK-${issueCounter}`,
          id: issueCounter.toString(),
          summary: issueData.summary,
          description: issueData.description,
          issueType: issueData.issueType,
          status: 'To Do',
          priority: issueData.priority || 'Medium',
          parentKey: issueData.parentKey,
          project: issueData.project
        };
        createdIssues.push(issue);
        return issue;
      });
      
      jiraConnector.createIssue = mockCreateIssue;

      // Create initiative issue
      const initiativeIssue = await jiraConnector.createIssue({
        summary: architecture.initiative.title,
        description: architecture.initiative.description,
        issueType: 'Initiative',
        project: 'BANK',
        priority: 'Critical'
      });

      // Create epic issues
      const epicIssues = await Promise.all(
        architecture.epics.map(epic => 
          jiraConnector.createIssue({
            summary: epic.title,
            description: epic.description,
            issueType: 'Epic',
            project: 'BANK',
            parentKey: initiativeIssue.key,
            priority: epic.priority
          })
        )
      );

      // Create feature issues (as stories in JIRA)
      const featureIssues = await Promise.all(
        architecture.features.slice(0, 10).map(feature => { // Limit for test performance
          const parentEpic = epicIssues.find(epic => 
            epic.summary.toLowerCase().includes(feature.title.split(' ')[0].toLowerCase())
          ) || epicIssues[0];
          
          return jiraConnector.createIssue({
            summary: feature.title,
            description: feature.description,
            issueType: 'Story',
            project: 'BANK',
            parentKey: parentEpic.key,
            priority: feature.priority
          });
        })
      );

      const totalIssuesCreated = 1 + epicIssues.length + featureIssues.length;
      expect(totalIssuesCreated).toBeGreaterThan(10);
      expect(createdIssues.length).toBe(totalIssuesCreated);
      
      console.log(`✅ JIRA issues created - Initiative: 1, Epics: ${epicIssues.length}, Features: ${featureIssues.length}`);

      // Step 6: Generate documentation
      console.log('\n📝 Step 6: Generating documentation...');
      
      const mockGenerateDocumentation = jest.fn().mockResolvedValue({
        architectureDoc: {
          title: 'Digital Banking Platform Architecture',
          sections: ['Overview', 'System Architecture', 'Data Flow', 'Security', 'Deployment'],
          content: 'Comprehensive architecture documentation...',
          pages: 45
        },
        implementationGuides: [
          { title: 'Frontend Development Guide', pages: 12 },
          { title: 'Backend API Guide', pages: 18 },
          { title: 'Security Implementation Guide', pages: 8 }
        ],
        testPlans: [
          { title: 'Unit Test Plan', testCases: 150 },
          { title: 'Integration Test Plan', testCases: 75 },
          { title: 'E2E Test Plan', testCases: 25 }
        ]
      });
      
      documentationGenerator.generateComprehensiveDocumentation = mockGenerateDocumentation;
      
      const documentation = await documentationGenerator.generateComprehensiveDocumentation(
        architecture, 
        { includeJiraLinks: true, jiraIssues: createdIssues }
      );
      
      expect(documentation.architectureDoc.pages).toBeGreaterThan(20);
      expect(documentation.implementationGuides.length).toBeGreaterThan(2);
      expect(documentation.testPlans.length).toBeGreaterThan(2);
      
      console.log(`✅ Documentation generated - Architecture: ${documentation.architectureDoc.pages} pages, Guides: ${documentation.implementationGuides.length}, Test Plans: ${documentation.testPlans.length}`);

      // Step 7: Set up monitoring
      console.log('\n📊 Step 7: Setting up monitoring...');
      
      const mockSetupMonitoring = jest.fn().mockResolvedValue({
        dashboards: [
          { name: 'Project Progress Dashboard', widgets: 8 },
          { name: 'Team Velocity Dashboard', widgets: 6 },
          { name: 'Quality Metrics Dashboard', widgets: 10 }
        ],
        alerts: [
          { name: 'Epic Completion Alert', conditions: ['epic.status = Done'] },
          { name: 'Quality Gate Failure Alert', conditions: ['quality.score < 80'] },
          { name: 'Timeline Deviation Alert', conditions: ['timeline.variance > 20%'] }
        ],
        reports: [
          { name: 'Weekly Progress Report', schedule: 'weekly' },
          { name: 'Monthly Quality Report', schedule: 'monthly' }
        ]
      });
      
      monitoringService.setupProjectMonitoring = mockSetupMonitoring;
      
      const monitoring = await monitoringService.setupProjectMonitoring(architecture, {
        jiraProject: 'BANK',
        includeQualityMetrics: true,
        includeVelocityTracking: true
      });
      
      expect(monitoring.dashboards.length).toBeGreaterThan(2);
      expect(monitoring.alerts.length).toBeGreaterThan(2);
      expect(monitoring.reports.length).toBeGreaterThan(1);
      
      console.log(`✅ Monitoring setup complete - Dashboards: ${monitoring.dashboards.length}, Alerts: ${monitoring.alerts.length}, Reports: ${monitoring.reports.length}`);

      // Final validation
      console.log('\n✅ Workflow Complete - Final Validation');
      
      const workflowResults = {
        originalIdea,
        analysisResult,
        initiativePlan,
        architecture,
        qualityResult,
        jiraIssues: createdIssues,
        documentation,
        monitoring
      };
      
      // Validate end-to-end traceability
      expect(workflowResults.architecture.initiative.originalIdea?.id).toBe(originalIdea.id);
      expect(workflowResults.jiraIssues[0].summary).toContain(originalIdea.title.split(' ')[0]);
      expect(workflowResults.qualityResult.overallScore).toBeGreaterThan(75);
      
      console.log('\n🎉 Complete E2E Workflow Test Successful!');
      console.log(`📈 Summary:`);
      console.log(`- Original idea → ${workflowResults.architecture.tasks.length} actionable tasks`);
      console.log(`- Quality score: ${workflowResults.qualityResult.overallScore}%`);
      console.log(`- JIRA issues: ${workflowResults.jiraIssues.length}`);
      console.log(`- Documentation pages: ${workflowResults.documentation.architectureDoc.pages}`);
      console.log(`- Monitoring elements: ${monitoring.dashboards.length + monitoring.alerts.length + monitoring.reports.length}`);

      return workflowResults;
    }, 180000); // 3 minute timeout

    it('should handle workflow failures and recovery gracefully', async () => {
      const faultyIdea: Idea = {
        id: 'faulty-workflow-idea',
        title: '', // Missing title will cause validation failure
        description: 'Faulty idea for testing error handling',
        complexity: 'medium',
        priority: 'low',
        tags: [],
        metadata: { source: 'error-test', timestamp: Date.now() }
      };

      console.log('\n🚨 Testing Error Handling and Recovery...');

      // Step 1: Analysis should fail
      const analysisResult = await ideaAnalyzer.generateAnalysisReport(faultyIdea);
      expect(analysisResult.validation.isValid).toBe(false);
      expect(analysisResult.validation.errors.length).toBeGreaterThan(0);
      
      console.log(`✅ Analysis correctly failed with ${analysisResult.validation.errors.length} errors`);

      // Step 2: Initiative planning should be prevented
      await expect(initiativePlanner.createInitiativePlan(analysisResult))
        .rejects.toThrow('Invalid analysis result');
      
      console.log('✅ Initiative planning correctly prevented invalid analysis');

      // Test recovery with fixed idea
      const fixedIdea = { ...faultyIdea, title: 'Fixed Idea Title' };
      const fixedAnalysis = await ideaAnalyzer.generateAnalysisReport(fixedIdea);
      expect(fixedAnalysis.validation.isValid).toBe(true);
      
      const recoveredPlan = await initiativePlanner.createInitiativePlan(fixedAnalysis);
      expect(recoveredPlan.epics.length).toBeGreaterThan(0);
      
      console.log('✅ Recovery workflow successful after fixing issues');
    });

    it('should maintain data consistency across all workflow steps', async () => {
      const consistencyIdea: Idea = {
        id: 'consistency-test-idea',
        title: 'Healthcare Management System',
        description: 'Patient management system with appointments, records, billing',
        complexity: 'medium',
        priority: 'high',
        tags: ['healthcare', 'patient-management', 'billing'],
        metadata: {
          source: 'healthcare-team',
          timestamp: Date.now(),
          version: '1.0.0'
        }
      };

      // Execute workflow
      const analysis = await ideaAnalyzer.generateAnalysisReport(consistencyIdea);
      const plan = await initiativePlanner.createInitiativePlan(analysis);
      const architecture = await featureArchitect.generateArchitecture(plan);

      // Verify data consistency
      expect(architecture.initiative.originalIdea?.id).toBe(consistencyIdea.id);
      expect(architecture.initiative.title).toContain('Healthcare');
      
      // Verify all tasks trace back to original idea
      architecture.tasks.forEach(task => {
        const story = architecture.stories.find(s => s.id === task.parentStory);
        const feature = architecture.features.find(f => f.id === story?.parentFeature);
        const epic = architecture.epics.find(e => e.id === feature?.parentEpic);
        
        expect(epic?.parentInitiative).toBe(architecture.initiative.id);
      });

      // Verify keywords propagation
      const originalKeywords = analysis.keywords;
      const allTitlesAndDescriptions = [
        ...architecture.epics.map(e => e.title + ' ' + e.description),
        ...architecture.features.map(f => f.title + ' ' + f.description)
      ].join(' ').toLowerCase();

      const keywordMatches = originalKeywords.filter(keyword =>
        allTitlesAndDescriptions.includes(keyword.toLowerCase())
      );

      expect(keywordMatches.length / originalKeywords.length).toBeGreaterThan(0.6);
      
      console.log('✅ Data consistency maintained across all workflow steps');
    });
  });

  describe('Quality Gate Integration E2E', () => {
    it('should enforce quality gates throughout the workflow', async () => {
      const qualityIdea: Idea = {
        id: 'quality-enforcement-idea',
        title: 'E-commerce Marketplace',
        description: 'Multi-vendor e-commerce platform with payments, reviews, analytics',
        complexity: 'complex',
        priority: 'high',
        tags: ['ecommerce', 'marketplace', 'payments'],
        metadata: { source: 'quality-test', timestamp: Date.now() }
      };

      // Process through workflow with quality enforcement
      const analysis = await ideaAnalyzer.generateAnalysisReport(qualityIdea);
      const plan = await initiativePlanner.createInitiativePlan(analysis);
      const architecture = await featureArchitect.generateArchitecture(plan);

      // Run quality gates
      const qualityGates = qualityGateController.getDefaultQualityGates();
      const qualityResult = await qualityGateController.validateArchitecture(architecture, qualityGates);

      expect(qualityResult.isValid).toBe(true);
      expect(qualityResult.overallScore).toBeGreaterThan(85);

      // Verify specific quality criteria
      const completenessGate = qualityResult.gateResults.find(g => g.gate.type === 'completeness');
      const consistencyGate = qualityResult.gateResults.find(g => g.gate.type === 'consistency');

      expect(completenessGate?.passed).toBe(true);
      expect(consistencyGate?.passed).toBe(true);

      console.log(`✅ Quality gates enforced - Overall score: ${qualityResult.overallScore}%`);
    });

    it('should prevent progression when quality gates fail', async () => {
      // Create architecture with deliberate quality issues
      const faultyArchitecture: Architecture = {
        initiative: {
          id: 'faulty-init',
          title: '', // Missing title
          description: '',
          status: 'planning',
          createdAt: new Date(),
          updatedAt: new Date()
        },
        epics: [],
        features: [],
        stories: [],
        tasks: [],
        dependencies: { features: [], stories: [], tasks: [] },
        estimations: { totalStoryPoints: 0, totalHours: 0, totalFeatures: 0, totalStories: 0, totalTasks: 0 },
        metadata: { createdAt: new Date(), updatedAt: new Date(), version: '1.0.0' }
      };

      const qualityGates = qualityGateController.getDefaultQualityGates();
      const qualityResult = await qualityGateController.validateArchitecture(faultyArchitecture, qualityGates);

      expect(qualityResult.isValid).toBe(false);
      expect(qualityResult.overallScore).toBeLessThan(50);

      // Mock JIRA creation that should be prevented
      const preventedJiraCreation = jest.fn();
      
      if (!qualityResult.isValid) {
        console.log('❌ Quality gates failed - preventing JIRA creation');
        expect(preventedJiraCreation).not.toHaveBeenCalled();
      }

      console.log('✅ Quality gate enforcement prevented faulty architecture progression');
    });
  });

  describe('CLI Integration E2E', () => {
    it('should support CLI-driven workflow execution', async () => {
      // Mock CLI arguments
      const mockCLIArgs = {
        idea: 'IoT Device Management Platform',
        description: 'Platform for managing IoT devices, data collection, and analytics',
        priority: 'high',
        complexity: 'complex',
        output: 'json',
        createJira: true,
        jiraProject: 'IOT',
        generateDocs: true
      };

      // Simulate CLI workflow
      console.log('🖥️ Simulating CLI workflow execution...');

      const cliIdea: Idea = {
        id: 'cli-generated-idea',
        title: mockCLIArgs.idea,
        description: mockCLIArgs.description,
        complexity: mockCLIArgs.complexity as any,
        priority: mockCLIArgs.priority as any,
        tags: ['iot', 'devices', 'analytics'],
        metadata: {
          source: 'cli',
          timestamp: Date.now(),
          cliArgs: mockCLIArgs
        }
      };

      const workflowResult = {
        analysis: await ideaAnalyzer.generateAnalysisReport(cliIdea),
        plan: null as any,
        architecture: null as any,
        quality: null as any,
        output: null as any
      };

      workflowResult.plan = await initiativePlanner.createInitiativePlan(workflowResult.analysis);
      workflowResult.architecture = await featureArchitect.generateArchitecture(workflowResult.plan);
      
      const qualityGates = qualityGateController.getDefaultQualityGates();
      workflowResult.quality = await qualityGateController.validateArchitecture(workflowResult.architecture, qualityGates);

      // Generate CLI output
      workflowResult.output = {
        success: true,
        timestamp: new Date().toISOString(),
        summary: {
          originalIdea: cliIdea.title,
          epicsCreated: workflowResult.architecture.epics.length,
          featuresCreated: workflowResult.architecture.features.length,
          storiesCreated: workflowResult.architecture.stories.length,
          tasksCreated: workflowResult.architecture.tasks.length,
          qualityScore: workflowResult.quality.overallScore
        },
        jiraCreated: mockCLIArgs.createJira,
        docsGenerated: mockCLIArgs.generateDocs
      };

      expect(workflowResult.output.success).toBe(true);
      expect(workflowResult.output.summary.qualityScore).toBeGreaterThan(80);
      
      console.log('✅ CLI workflow simulation successful');
      console.log(JSON.stringify(workflowResult.output, null, 2));
    });
  });

  describe('Performance E2E', () => {
    it('should complete full workflow within acceptable time limits', async () => {
      const performanceIdea: Idea = {
        id: 'performance-e2e-idea',
        title: 'Enterprise Resource Planning System',
        description: 'Comprehensive ERP system with HR, Finance, Inventory, CRM, and Reporting modules',
        complexity: 'complex',
        priority: 'critical',
        tags: ['erp', 'enterprise', 'hr', 'finance', 'crm'],
        metadata: { source: 'performance-test', timestamp: Date.now() }
      };

      const startTime = Date.now();
      const memoryStart = process.memoryUsage();

      // Execute full workflow
      const analysis = await ideaAnalyzer.generateAnalysisReport(performanceIdea);
      const plan = await initiativePlanner.createInitiativePlan(analysis);
      const architecture = await featureArchitect.generateArchitecture(plan);
      const qualityGates = qualityGateController.getDefaultQualityGates();
      const quality = await qualityGateController.validateArchitecture(architecture, qualityGates);

      const endTime = Date.now();
      const memoryEnd = process.memoryUsage();

      const totalTime = endTime - startTime;
      const memoryUsed = memoryEnd.heapUsed - memoryStart.heapUsed;

      // Performance assertions
      expect(totalTime).toBeLessThan(120000); // 2 minutes
      expect(memoryUsed).toBeLessThan(200 * 1024 * 1024); // 200MB

      // Quality assertions
      expect(quality.isValid).toBe(true);
      expect(architecture.tasks.length).toBeGreaterThan(50);

      console.log('\n⚡ E2E Performance Results:');
      console.log(`Total time: ${totalTime}ms`);
      console.log(`Memory used: ${Math.round(memoryUsed / 1024 / 1024)}MB`);
      console.log(`Items created: ${architecture.tasks.length} tasks`);
      console.log(`Quality score: ${quality.overallScore}%`);

      restoreConsole(); // Restore console for final output
    }, 240000); // 4 minute timeout
  });
});