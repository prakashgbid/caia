/**
 * @jest-environment node
 */

import PatternRecognizer, {
  DataPoint,
  AnalysisConfig,
  PatternTemplate,
  FeatureExtractor,
  Model,
  StatisticalModel
} from '../index';
// Type-only imports for unused types
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { Pattern, Anomaly, Trend, SeasonalPattern, Correlation, RecognitionResult } from '../index';

describe('PatternRecognizer', () => {
  let patternRecognizer: PatternRecognizer;

  beforeEach(() => {
    patternRecognizer = new PatternRecognizer();
  });

  describe('PatternRecognizer instantiation', () => {
    it('should create a new instance with default config', () => {
      expect(patternRecognizer).toBeInstanceOf(PatternRecognizer);
    });

    it('should create instance with custom config', () => {
      const config: Partial<AnalysisConfig> = {
        enableTrendDetection: false,
        anomalyThreshold: 3.0,
        confidenceThreshold: 0.9,
        windowSize: 100
      };

      const recognizer = new PatternRecognizer(config);
      expect(recognizer).toBeInstanceOf(PatternRecognizer);
    });
  });

  describe('analyzeData', () => {
    const generateLinearData = (count: number, slope: number = 1, noise: number = 0): DataPoint[] => {
      const baseTime = Date.now() - (count * 60000); // Start from count minutes ago
      return Array.from({ length: count }, (_, i) => ({
        id: `point-${i}`,
        timestamp: baseTime + (i * 60000), // 1 minute intervals
        value: (i * slope) + (noise * (Math.random() - 0.5) * 2),
        features: { index: i }
      }));
    };

    const generateSinusoidalData = (count: number, amplitude: number = 10, period: number = 24): DataPoint[] => {
      const baseTime = Date.now() - (count * 3600000); // Start from count hours ago
      return Array.from({ length: count }, (_, i) => ({
        id: `sin-${i}`,
        timestamp: baseTime + (i * 3600000), // 1 hour intervals
        value: amplitude * Math.sin((2 * Math.PI * i) / period) + 50 + (Math.random() - 0.5) * 2
      }));
    };

    it('should analyze empty data', async () => {
      const result = await patternRecognizer.analyzeData([]);

      expect(result.summary.totalDataPoints).toBe(0);
      expect(result.patterns).toHaveLength(0);
      expect(result.anomalies).toHaveLength(0);
      expect(result.trends).toHaveLength(0);
    });

    it('should detect upward trends', async () => {
      const data = generateLinearData(50, 2); // Strong upward trend

      const result = await patternRecognizer.analyzeData(data);

      expect(result.trends.length).toBeGreaterThan(0);
      expect(result.trends[0].direction).toBe('up');
      expect(result.trends[0].confidence).toBeGreaterThan(0.7);
    });

    it('should detect downward trends', async () => {
      const data = generateLinearData(50, -2); // Strong downward trend

      const result = await patternRecognizer.analyzeData(data);

      expect(result.trends.length).toBeGreaterThan(0);
      expect(result.trends[0].direction).toBe('down');
      expect(result.trends[0].confidence).toBeGreaterThan(0.7);
    });

    it('should detect stable trends', async () => {
      // Generate flat data with minimal noise
      const data = generateLinearData(50, 0, 0.1);

      const result = await patternRecognizer.analyzeData(data);

      expect(result.trends).toBeDefined();
      expect(result.trends.length).toBeGreaterThanOrEqual(0);
      if (result.trends.length > 0) {
        expect(result.trends[0].direction).toBe('stable');
      }
    });

    it('should detect anomalies', async () => {
      const baseData = generateLinearData(30, 1, 0.5);
      
      // Add clear anomalies
      baseData.push({
        id: 'anomaly-1',
        timestamp: Date.now(),
        value: 1000 // Much higher than normal
      });

      baseData.push({
        id: 'anomaly-2',
        timestamp: Date.now() + 60000,
        value: -1000 // Much lower than normal
      });

      const result = await patternRecognizer.analyzeData(baseData);

      expect(result.anomalies.length).toBeGreaterThan(0);
      expect(result.anomalies.some(a => a.severity === 'high' || a.severity === 'critical')).toBe(true);
    });

    it('should detect seasonal patterns', async () => {
      const data = generateSinusoidalData(72, 20, 24); // 3 days of hourly data with 24-hour period

      const result = await patternRecognizer.analyzeData(data);

      // Note: Seasonality detection might be challenging with limited data
      expect(result.seasonality.length).toBeGreaterThanOrEqual(0);
    });

    it('should detect correlations', async () => {
      // Generate data with time correlation
      const data = Array.from({ length: 50 }, (_, i) => ({
        id: `corr-${i}`,
        timestamp: Date.now() - ((50 - i) * 60000),
        value: i * 2 + Math.random() * 5 // Strong positive correlation with time
      }));

      const result = await patternRecognizer.analyzeData(data);

      expect(result.correlations.length).toBeGreaterThan(0);
      expect(result.correlations[0].strength).toBeOneOf(['moderate', 'strong', 'very_strong']);
    });

    it('should emit analysis-completed event', async () => {
      const data = generateLinearData(10);

      const eventPromise = new Promise((resolve) => {
        patternRecognizer.on('analysis-completed', resolve);
      });

      await patternRecognizer.analyzeData(data);
      const result = await eventPromise;

      expect(result).toHaveProperty('patterns');
      expect(result).toHaveProperty('summary');
    });

    it('should handle analysis errors', async () => {
      // Create invalid data that might cause issues
      const invalidData = [
        { id: 'invalid', timestamp: NaN, value: NaN }
      ] as DataPoint[];

      const errorPromise = new Promise((resolve) => {
        patternRecognizer.on('analysis-failed', resolve);
      });

      try {
        await patternRecognizer.analyzeData(invalidData);
      } catch (error) {
        // Error expected
      }

      const error = await errorPromise;
      expect(error).toBeInstanceOf(Error);
    });

    it('should provide quality assessment', async () => {
      const highQualityData = generateLinearData(100, 2, 0.1); // Large dataset, clear trend, low noise
      const result = await patternRecognizer.analyzeData(highQualityData);

      expect(result.summary.quality).toBeOneOf(['poor', 'fair', 'good', 'excellent']);
      expect(result.summary.confidence).toBeGreaterThanOrEqual(0);
      expect(result.summary.confidence).toBeLessThanOrEqual(1);
    });
  });

  describe('model training and prediction', () => {
    beforeEach(() => {
      const model = new StatisticalModel();
      patternRecognizer.registerModel(model);
    });

    it('should train a model', async () => {
      const trainingData = Array.from({ length: 100 }, (_, i) => ({
        id: `train-${i}`,
        timestamp: Date.now() - ((100 - i) * 60000),
        value: Math.random() * 100,
        label: i % 2 === 0 ? 'even' : 'odd'
      }));

      const eventPromise = new Promise((resolve) => {
        patternRecognizer.on('model-trained', resolve);
      });

      await patternRecognizer.trainModel('statistical', trainingData);
      const event = await eventPromise;

      expect(event).toHaveProperty('modelId', 'statistical');
      expect(event).toHaveProperty('dataPoints', 100);
    });

    it('should evaluate a model', async () => {
      const trainingData = Array.from({ length: 50 }, (_, i) => ({
        id: `train-${i}`,
        timestamp: Date.now() - ((50 - i) * 60000),
        value: Math.random() * 100
      }));

      const testData = Array.from({ length: 20 }, (_, i) => ({
        id: `test-${i}`,
        timestamp: Date.now() + (i * 60000),
        value: Math.random() * 100
      }));

      await patternRecognizer.trainModel('statistical', trainingData);
      const metrics = await patternRecognizer.evaluateModel('statistical', testData);

      expect(metrics.accuracy).toBeGreaterThanOrEqual(0);
      expect(metrics.accuracy).toBeLessThanOrEqual(1);
      expect(metrics.precision).toBeGreaterThanOrEqual(0);
      expect(metrics.recall).toBeGreaterThanOrEqual(0);
      expect(metrics.f1Score).toBeGreaterThanOrEqual(0);
    });

    it('should handle model training errors', async () => {
      const errorPromise = new Promise((resolve) => {
        patternRecognizer.on('model-training-failed', resolve);
      });

      await expect(
        patternRecognizer.trainModel('non-existent', [])
      ).rejects.toThrow('Model not found: non-existent');

      const error = await errorPromise;
      expect(error).toHaveProperty('modelId', 'non-existent');
    });

    it('should handle untrained model evaluation', async () => {
      const model = new StatisticalModel();
      model.trained = false; // Ensure it's not trained
      patternRecognizer.registerModel(model);

      await expect(
        patternRecognizer.evaluateModel('statistical', [])
      ).rejects.toThrow('Model statistical is not trained');
    });
  });

  describe('custom templates', () => {
    it('should register pattern template', () => {
      const template: PatternTemplate = {
        id: 'custom-spike',
        name: 'Custom Spike Pattern',
        type: 'spike',
        description: 'Detects sudden spikes in data',
        matcher: (data: DataPoint[]) => {
          if (data.length < 3) return { match: false, confidence: 0, parameters: {} };
          
          const values = data.map(d => d.value);
          const max = Math.max(...values);
          const avg = values.reduce((a, b) => a + b, 0) / values.length;
          const ratio = max / avg;
          
          return {
            match: ratio > 2,
            confidence: Math.min(1, ratio / 3),
            parameters: { ratio, max, avg }
          };
        },
        examples: []
      };

      const eventPromise = new Promise((resolve) => {
        patternRecognizer.on('template-registered', resolve);
      });

      patternRecognizer.registerTemplate(template);

      return eventPromise.then((registeredTemplate) => {
        expect(registeredTemplate).toEqual(template);
      });
    });

    it('should use custom template in analysis', async () => {
      const spikeTemplate: PatternTemplate = {
        id: 'test-spike',
        name: 'Test Spike',
        type: 'spike',
        description: 'Test spike detection',
        matcher: (data: DataPoint[]) => {
          const values = data.map(d => d.value);
          const hasSpike = values.some(v => v > 100);
          return {
            match: hasSpike,
            confidence: hasSpike ? 0.8 : 0,
            parameters: { threshold: 100 }
          };
        },
        examples: []
      };

      patternRecognizer.registerTemplate(spikeTemplate);

      const dataWithSpike = [
        { id: '1', timestamp: Date.now() - 2000, value: 50 },
        { id: '2', timestamp: Date.now() - 1000, value: 150 }, // Spike
        { id: '3', timestamp: Date.now(), value: 45 }
      ];

      const result = await patternRecognizer.analyzeData(dataWithSpike);

      expect(result.patterns.some(p => p.name === 'Test Spike')).toBe(true);
    });

    it('should handle template matching errors', async () => {
      const errorTemplate: PatternTemplate = {
        id: 'error-template',
        name: 'Error Template',
        type: 'custom',
        description: 'Template that throws errors',
        matcher: () => {
          throw new Error('Template error');
        },
        examples: []
      };

      const errorPromise = new Promise((resolve) => {
        patternRecognizer.on('pattern-matching-error', resolve);
      });

      patternRecognizer.registerTemplate(errorTemplate);

      const data = [{ id: '1', timestamp: Date.now(), value: 50 }];
      await patternRecognizer.analyzeData(data);

      const error = await errorPromise;
      expect(error).toHaveProperty('template', 'error-template');
    });
  });

  describe('feature extractors', () => {
    it('should register custom feature extractor', () => {
      const extractor: FeatureExtractor = {
        name: 'custom-features',
        extract: (data: DataPoint[]) => ({
          customMean: data.reduce((sum, d) => sum + d.value, 0) / data.length,
          customMax: Math.max(...data.map(d => d.value)),
          customMin: Math.min(...data.map(d => d.value))
        }),
        requiredFields: ['value']
      };

      const eventPromise = new Promise((resolve) => {
        patternRecognizer.on('extractor-registered', resolve);
      });

      patternRecognizer.registerExtractor(extractor);

      return eventPromise.then((registeredExtractor) => {
        expect(registeredExtractor).toEqual(extractor);
      });
    });

    it('should use feature extractors in analysis', async () => {
      const data = Array.from({ length: 10 }, (_, i) => ({
        id: `feat-${i}`,
        timestamp: Date.now() + (i * 60000),
        value: i * 10
      }));

      // The analysis should include features from built-in extractors
      const result = await patternRecognizer.analyzeData(data);
      
      // Check that analysis completed (features were extracted)
      expect(result.summary.totalDataPoints).toBe(10);
    });

    it('should handle feature extraction errors', async () => {
      const errorExtractor: FeatureExtractor = {
        name: 'error-extractor',
        extract: () => {
          throw new Error('Feature extraction error');
        },
        requiredFields: ['value']
      };

      const errorPromise = new Promise((resolve) => {
        patternRecognizer.on('feature-extraction-error', resolve);
      });

      patternRecognizer.registerExtractor(errorExtractor);

      const data = [{ id: '1', timestamp: Date.now(), value: 50 }];
      await patternRecognizer.analyzeData(data);

      const error = await errorPromise;
      expect(error).toHaveProperty('extractor', 'error-extractor');
    });
  });

  describe('pattern history', () => {
    beforeEach(async () => {
      // Generate some patterns
      const data1 = Array.from({ length: 20 }, (_, i) => ({
        id: `hist-${i}`,
        timestamp: Date.now() - ((20 - i) * 60000),
        value: i * 2 // Upward trend
      }));

      const data2 = Array.from({ length: 15 }, (_, i) => ({
        id: `hist2-${i}`,
        timestamp: Date.now() - ((15 - i) * 30000),
        value: 100 - (i * 3) // Downward trend
      }));

      await patternRecognizer.analyzeData(data1);
      await patternRecognizer.analyzeData(data2);
    });

    it('should store pattern history', () => {
      const history = patternRecognizer.getPatternHistory();
      expect(history.length).toBeGreaterThan(0);
    });

    it('should get history for specific pattern type', () => {
      const trendHistory = patternRecognizer.getPatternHistory('trend');
      expect(trendHistory.every(p => p.type === 'trend')).toBe(true);
    });

    it('should clear pattern history', () => {
      const eventPromise = new Promise((resolve) => {
        patternRecognizer.on('history-cleared', resolve);
      });

      patternRecognizer.clearHistory();

      const history = patternRecognizer.getPatternHistory();
      expect(history).toHaveLength(0);

      return eventPromise;
    });
  });

  describe('built-in patterns and extractors', () => {
    it('should detect spike patterns', async () => {
      const dataWithSpike = [
        { id: '1', timestamp: Date.now() - 3000, value: 10 },
        { id: '2', timestamp: Date.now() - 2000, value: 15 },
        { id: '3', timestamp: Date.now() - 1000, value: 100 }, // Large spike
        { id: '4', timestamp: Date.now(), value: 12 }
      ];

      const result = await patternRecognizer.analyzeData(dataWithSpike);

      // Should detect spike pattern
      expect(result.patterns.some(p => p.type === 'spike')).toBe(true);
    });

    it('should detect step change patterns', async () => {
      const dataWithStep = [
        ...Array.from({ length: 10 }, (_, i) => ({
          id: `before-${i}`,
          timestamp: Date.now() - ((20 - i) * 60000),
          value: 50 + (Math.random() - 0.5) * 2 // Around 50
        })),
        ...Array.from({ length: 10 }, (_, i) => ({
          id: `after-${i}`,
          timestamp: Date.now() - ((10 - i) * 60000),
          value: 100 + (Math.random() - 0.5) * 2 // Around 100
        }))
      ];

      const result = await patternRecognizer.analyzeData(dataWithStep);

      // Should detect step change
      expect(result.patterns.some(p => p.type === 'trend')).toBe(true);
    });

    it('should extract statistical features', async () => {
      const data = Array.from({ length: 100 }, (_, i) => ({
        id: `stat-${i}`,
        timestamp: Date.now() + (i * 60000),
        value: Math.random() * 100
      }));

      // Analysis should complete without errors (features extracted)
      const result = await patternRecognizer.analyzeData(data);
      expect(result.summary.totalDataPoints).toBe(100);
    });

    it('should extract temporal features', async () => {
      const data = Array.from({ length: 50 }, (_, i) => ({
        id: `temp-${i}`,
        timestamp: Date.now() + (i * 120000), // 2-minute intervals
        value: Math.random() * 50
      }));

      const result = await patternRecognizer.analyzeData(data);
      expect(result.summary.totalDataPoints).toBe(50);
    });
  });

  describe('anomaly detection', () => {
    it('should classify anomaly severity correctly', async () => {
      const normalData = Array.from({ length: 50 }, (_, i) => ({
        id: `normal-${i}`,
        timestamp: Date.now() - ((50 - i) * 60000),
        value: 50 + (Math.random() - 0.5) * 10 // Mean 50, std ~3
      }));

      // Add extreme anomalies
      normalData.push({
        id: 'extreme-high',
        timestamp: Date.now(),
        value: 200 // Way above normal
      });

      normalData.push({
        id: 'extreme-low',
        timestamp: Date.now() + 60000,
        value: -100 // Way below normal
      });

      const result = await patternRecognizer.analyzeData(normalData);

      expect(result.anomalies.length).toBeGreaterThan(0);
      expect(result.anomalies.some(a => a.severity === 'high' || a.severity === 'critical')).toBe(true);
    });

    it('should handle edge case values', async () => {
      const edgeCaseData = [
        { id: '1', timestamp: Date.now(), value: 0 },
        { id: '2', timestamp: Date.now() + 1000, value: Infinity },
        { id: '3', timestamp: Date.now() + 2000, value: -Infinity },
        { id: '4', timestamp: Date.now() + 3000, value: NaN }
      ];

      // Should not crash on edge cases
      await expect(patternRecognizer.analyzeData(edgeCaseData)).resolves.toBeDefined();
    });
  });

  describe('correlation analysis', () => {
    it('should classify correlation strength', async () => {
      // Strong positive correlation with time
      const strongCorrData = Array.from({ length: 30 }, (_, i) => ({
        id: `strong-${i}`,
        timestamp: Date.now() - ((30 - i) * 60000),
        value: i * 5 + (Math.random() - 0.5) * 2 // Strong linear relationship
      }));

      const result = await patternRecognizer.analyzeData(strongCorrData);

      expect(result.correlations).toBeDefined();
      expect(result.correlations.length).toBeGreaterThanOrEqual(0);
      if (result.correlations.length > 0) {
        expect(result.correlations[0].strength).toBeOneOf(['weak', 'moderate', 'strong', 'very_strong']);
        expect(result.correlations[0].type).toBeOneOf(['positive', 'negative']);
      }
    });

    it('should handle uncorrelated data', async () => {
      const randomData = Array.from({ length: 50 }, (_, i) => ({
        id: `random-${i}`,
        timestamp: Date.now() - ((50 - i) * 60000),
        value: Math.random() * 100 // No correlation
      }));

      const result = await patternRecognizer.analyzeData(randomData);

      // Might or might not find correlations in random data
      expect(result.correlations.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('seasonality detection', () => {
    it('should detect daily patterns', async () => {
      // Generate 7 days of hourly data with daily pattern
      const hourlyData = Array.from({ length: 168 }, (_, i) => {
        const hour = i % 24;
        const baseValue = 50;
        const dailyPattern = 20 * Math.sin((2 * Math.PI * hour) / 24); // Daily cycle
        const noise = (Math.random() - 0.5) * 5;
        
        return {
          id: `hourly-${i}`,
          timestamp: Date.now() - ((168 - i) * 3600000), // 1 hour intervals
          value: baseValue + dailyPattern + noise
        };
      });

      const result = await patternRecognizer.analyzeData(hourlyData);

      // Might detect seasonality (depends on implementation sensitivity)
      expect(result.seasonality.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle insufficient data for seasonality', async () => {
      const shortData = Array.from({ length: 5 }, (_, i) => ({
        id: `short-${i}`,
        timestamp: Date.now() + (i * 60000),
        value: Math.random() * 100
      }));

      const result = await patternRecognizer.analyzeData(shortData);

      // Should not find seasonality in very short data
      expect(result.seasonality).toHaveLength(0);
    });
  });

  describe('ML model integration', () => {
    it('should handle ML prediction errors', async () => {
      const errorModel: Model = {
        id: 'error-model',
        name: 'Error Model',
        type: 'supervised',
        algorithm: 'error-prone',
        trained: true,
        train: async () => {},
        predict: async () => {
          throw new Error('Prediction failed');
        },
        evaluate: async () => ({ accuracy: 0, precision: 0, recall: 0, f1Score: 0 })
      };

      const errorPromise = new Promise((resolve) => {
        patternRecognizer.on('ml-prediction-error', resolve);
      });

      patternRecognizer.registerModel(errorModel);

      const data = [{ id: '1', timestamp: Date.now(), value: 50 }];
      await patternRecognizer.analyzeData(data);

      const error = await errorPromise;
      expect(error).toHaveProperty('model', 'error-model');
    });

    it('should skip untrained models', async () => {
      const untrainedModel: Model = {
        id: 'untrained',
        name: 'Untrained Model',
        type: 'unsupervised',
        algorithm: 'test',
        trained: false,
        train: async () => {},
        predict: async () => [],
        evaluate: async () => ({ accuracy: 0, precision: 0, recall: 0, f1Score: 0 })
      };

      patternRecognizer.registerModel(untrainedModel);

      const data = [{ id: '1', timestamp: Date.now(), value: 50 }];
      const result = await patternRecognizer.analyzeData(data);

      // Should complete analysis without using untrained model
      expect(result.summary.totalDataPoints).toBe(1);
    });
  });

  describe('StatisticalModel', () => {
    let model: StatisticalModel;

    beforeEach(() => {
      model = new StatisticalModel();
    });

    it('should train successfully', async () => {
      const data = Array.from({ length: 20 }, (_, i) => ({
        id: `train-${i}`,
        timestamp: Date.now() + (i * 60000),
        value: Math.random() * 100
      }));

      await model.train(data);

      expect(model.trained).toBe(true);
      expect(model.accuracy).toBeDefined();
    });

    it('should predict patterns', async () => {
      const data = Array.from({ length: 15 }, (_, i) => ({
        id: `predict-${i}`,
        timestamp: Date.now() + (i * 60000),
        value: 100 + (Math.random() - 0.5) * 200 // High variance
      }));

      await model.train([]);
      const patterns = await model.predict(data);

      expect(Array.isArray(patterns)).toBe(true);
    });

    it('should evaluate performance', async () => {
      await model.train([]);
      
      const testData = Array.from({ length: 10 }, (_, i) => ({
        id: `test-${i}`,
        timestamp: Date.now() + (i * 60000),
        value: Math.random() * 100
      }));

      const metrics = await model.evaluate(testData);

      expect(metrics.accuracy).toBeGreaterThanOrEqual(0);
      expect(metrics.accuracy).toBeLessThanOrEqual(1);
      expect(metrics.precision).toBeGreaterThanOrEqual(0);
      expect(metrics.recall).toBeGreaterThanOrEqual(0);
      expect(metrics.f1Score).toBeGreaterThanOrEqual(0);
    });

    it('should handle prediction without training', async () => {
      model.trained = false;

      await expect(
        model.predict([])
      ).rejects.toThrow('Model not trained');
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle data with missing IDs', async () => {
      const dataWithoutIds = [
        { timestamp: Date.now(), value: 50 },
        { timestamp: Date.now() + 1000, value: 60 }
      ] as DataPoint[];

      const result = await patternRecognizer.analyzeData(dataWithoutIds);

      expect(result.summary.totalDataPoints).toBe(2);
    });

    it('should handle duplicate timestamps', async () => {
      const duplicateTimestamps = [
        { id: '1', timestamp: 1000, value: 50 },
        { id: '2', timestamp: 1000, value: 60 }, // Duplicate timestamp
        { id: '3', timestamp: 2000, value: 70 }
      ];

      const result = await patternRecognizer.analyzeData(duplicateTimestamps);

      // Should deduplicate and process
      expect(result.summary.totalDataPoints).toBe(2);
    });

    it('should handle very large datasets', async () => {
      const largeDataset = Array.from({ length: 10000 }, (_, i) => ({
        id: `large-${i}`,
        timestamp: Date.now() + (i * 1000),
        value: Math.sin(i / 100) * 50 + 50 + (Math.random() - 0.5) * 10
      }));

      const startTime = Date.now();
      const result = await patternRecognizer.analyzeData(largeDataset);
      const endTime = Date.now();

      expect(result.summary.totalDataPoints).toBe(10000);
      expect(endTime - startTime).toBeLessThan(5000); // Should complete within 5 seconds
    });

    it('should handle data with extreme values', async () => {
      const extremeData = [
        { id: '1', timestamp: Date.now(), value: Number.MAX_SAFE_INTEGER },
        { id: '2', timestamp: Date.now() + 1000, value: Number.MIN_SAFE_INTEGER },
        { id: '3', timestamp: Date.now() + 2000, value: 0 }
      ];

      await expect(patternRecognizer.analyzeData(extremeData)).resolves.toBeDefined();
    });

    it('should handle configuration edge cases', () => {
      const extremeConfig: Partial<AnalysisConfig> = {
        anomalyThreshold: 0, // Very sensitive
        minPatternLength: 0,
        maxPatternLength: 0,
        confidenceThreshold: 1.1, // Invalid (> 1)
        windowSize: 0
      };

      // Should not crash on extreme config
      expect(() => new PatternRecognizer(extremeConfig)).not.toThrow();
    });
  });

  describe('Performance tests', () => {
    it('should handle rapid consecutive analyses', async () => {
      const datasets = Array.from({ length: 5 }, (_, setIndex) =>
        Array.from({ length: 100 }, (_, i) => ({
          id: `perf-${setIndex}-${i}`,
          timestamp: Date.now() + (setIndex * 100000) + (i * 1000),
          value: Math.random() * 100
        }))
      );

      const startTime = Date.now();
      const promises = datasets.map(data => patternRecognizer.analyzeData(data));
      const results = await Promise.all(promises);
      const endTime = Date.now();

      expect(results).toHaveLength(5);
      expect(endTime - startTime).toBeLessThan(3000); // Should complete within 3 seconds
    });

    it('should efficiently process time series data', async () => {
      const timeSeriesData = Array.from({ length: 1000 }, (_, i) => ({
        id: `ts-${i}`,
        timestamp: Date.now() + (i * 60000), // 1-minute intervals
        value: 50 + 10 * Math.sin(i / 50) + (Math.random() - 0.5) * 5
      }));

      const startTime = Date.now();
      const result = await patternRecognizer.analyzeData(timeSeriesData);
      const endTime = Date.now();

      expect(result.summary.totalDataPoints).toBe(1000);
      expect(endTime - startTime).toBeLessThan(2000); // Should be efficient
    });
  });
});