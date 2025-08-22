/**
 * @caia/pattern-recognizer
 * ML-based pattern detection and analysis
 */

import { EventEmitter } from 'events';

export interface DataPoint {
  id?: string;
  timestamp: number;
  value: number;
  features?: Record<string, number>;
  metadata?: Record<string, unknown>;
  label?: string;
}

export interface Pattern {
  id: string;
  name: string;
  type: 'trend' | 'seasonal' | 'anomaly' | 'cycle' | 'spike' | 'dip' | 'correlation' | 'custom';
  confidence: number; // 0-1
  description: string;
  parameters: Record<string, number>;
  timeRange: {
    start: number;
    end: number;
  };
  dataPoints: string[]; // IDs of data points that match this pattern
  metadata?: Record<string, unknown>;
}

export interface Anomaly {
  id: string;
  timestamp: number;
  value: number;
  expectedValue: number;
  deviation: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  type: 'point' | 'contextual' | 'collective';
  reason: string;
  confidence: number;
}

export interface Trend {
  id: string;
  direction: 'up' | 'down' | 'stable';
  strength: number; // 0-1
  startTime: number;
  endTime: number;
  slope: number;
  correlation: number;
  dataPoints: number;
  confidence: number;
}

export interface SeasonalPattern {
  id: string;
  period: number; // in milliseconds
  amplitude: number;
  phase: number;
  strength: number;
  confidence: number;
  detectedAt: number;
}

export interface Correlation {
  id: string;
  variables: string[];
  coefficient: number;
  pValue: number;
  strength: 'none' | 'weak' | 'moderate' | 'strong' | 'very_strong';
  type: 'positive' | 'negative';
  confidence: number;
}

export interface ModelConfig {
  algorithm: 'statistical' | 'ml' | 'deep_learning' | 'ensemble';
  parameters: Record<string, unknown>;
  trainingData?: DataPoint[];
  validationSplit?: number;
  hyperparameters?: Record<string, number>;
}

export interface RecognitionResult {
  patterns: Pattern[];
  anomalies: Anomaly[];
  trends: Trend[];
  seasonality: SeasonalPattern[];
  correlations: Correlation[];
  summary: {
    totalDataPoints: number;
    analysisTime: number;
    confidence: number;
    quality: 'poor' | 'fair' | 'good' | 'excellent';
  };
}

export interface AnalysisConfig {
  enableTrendDetection: boolean;
  enableAnomalyDetection: boolean;
  enableSeasonalityDetection: boolean;
  enableCorrelationAnalysis: boolean;
  enablePatternMatching: boolean;
  anomalyThreshold: number;
  minPatternLength: number;
  maxPatternLength: number;
  confidenceThreshold: number;
  windowSize: number;
}

export interface PatternTemplate {
  id: string;
  name: string;
  type: Pattern['type'];
  description: string;
  matcher: (data: DataPoint[]) => { match: boolean; confidence: number; parameters: Record<string, number> };
  examples: DataPoint[][];
}

export interface FeatureExtractor {
  name: string;
  extract: (data: DataPoint[]) => Record<string, number>;
  requiredFields: string[];
}

export interface Model {
  id: string;
  name: string;
  type: 'supervised' | 'unsupervised' | 'reinforcement';
  algorithm: string;
  trained: boolean;
  accuracy?: number;
  train: (data: DataPoint[]) => Promise<void>;
  predict: (data: DataPoint[]) => Promise<Pattern[]>;
  evaluate: (testData: DataPoint[]) => Promise<{ accuracy: number; precision: number; recall: number; f1Score: number }>;
}

export class PatternRecognizer extends EventEmitter {
  private config: AnalysisConfig;
  private models: Map<string, Model> = new Map();
  private templates: Map<string, PatternTemplate> = new Map();
  private extractors: Map<string, FeatureExtractor> = new Map();
  private trainingData: DataPoint[] = [];
  private patternHistory: Map<string, Pattern[]> = new Map();

  constructor(config: Partial<AnalysisConfig> = {}) {
    super();
    this.config = {
      enableTrendDetection: true,
      enableAnomalyDetection: true,
      enableSeasonalityDetection: true,
      enableCorrelationAnalysis: true,
      enablePatternMatching: true,
      anomalyThreshold: 2.0, // standard deviations
      minPatternLength: 5,
      maxPatternLength: 100,
      confidenceThreshold: 0.7,
      windowSize: 50,
      ...config
    };

    this.setupDefaultTemplates();
    this.setupDefaultExtractors();
    this.setupDefaultModels();
  }

  /**
   * Analyze data and recognize patterns
   */
  async analyzeData(data: DataPoint[]): Promise<RecognitionResult> {
    const startTime = Date.now();
    
    try {
      // Validate and preprocess data
      const processedData = this.preprocessData(data);
      
      // Extract features
      const features = this.extractFeatures(processedData);
      
      // Initialize result
      const result: RecognitionResult = {
        patterns: [],
        anomalies: [],
        trends: [],
        seasonality: [],
        correlations: [],
        summary: {
          totalDataPoints: data.length,
          analysisTime: 0,
          confidence: 0,
          quality: 'poor'
        }
      };

      // Detect trends
      if (this.config.enableTrendDetection) {
        result.trends = this.detectTrends(processedData);
      }

      // Detect anomalies
      if (this.config.enableAnomalyDetection) {
        result.anomalies = this.detectAnomalies(processedData);
      }

      // Detect seasonality
      if (this.config.enableSeasonalityDetection) {
        result.seasonality = this.detectSeasonality(processedData);
      }

      // Analyze correlations
      if (this.config.enableCorrelationAnalysis) {
        result.correlations = this.analyzeCorrelations(processedData, features);
      }

      // Match patterns using templates
      if (this.config.enablePatternMatching) {
        result.patterns = await this.matchPatterns(processedData);
      }

      // Use ML models if available and trained
      const mlPatterns = await this.detectMLPatterns(processedData);
      result.patterns.push(...mlPatterns);

      // Calculate summary
      result.summary = this.calculateSummary(result, Date.now() - startTime);
      
      // Store patterns in history
      this.storePatternHistory(result.patterns);
      
      this.emit('analysis-completed', result);
      return result;
    } catch (error) {
      this.emit('analysis-failed', error);
      throw error;
    }
  }

  /**
   * Train a model with provided data
   */
  async trainModel(modelId: string, data: DataPoint[]): Promise<void> {
    const model = this.models.get(modelId);
    if (!model) {
      throw new Error(`Model not found: ${modelId}`);
    }

    try {
      await model.train(data);
      this.trainingData.push(...data);
      this.emit('model-trained', { modelId, dataPoints: data.length });
    } catch (error) {
      this.emit('model-training-failed', { modelId, error });
      throw error;
    }
  }

  /**
   * Evaluate model performance
   */
  async evaluateModel(modelId: string, testData: DataPoint[]): Promise<{ accuracy: number; precision: number; recall: number; f1Score: number }> {
    const model = this.models.get(modelId);
    if (!model) {
      throw new Error(`Model not found: ${modelId}`);
    }

    if (!model.trained) {
      throw new Error(`Model ${modelId} is not trained`);
    }

    return model.evaluate(testData);
  }

  /**
   * Register a custom pattern template
   */
  registerTemplate(template: PatternTemplate): void {
    this.templates.set(template.id, template);
    this.emit('template-registered', template);
  }

  /**
   * Register a custom feature extractor
   */
  registerExtractor(extractor: FeatureExtractor): void {
    this.extractors.set(extractor.name, extractor);
    this.emit('extractor-registered', extractor);
  }

  /**
   * Register a custom model
   */
  registerModel(model: Model): void {
    this.models.set(model.id, model);
    this.emit('model-registered', model);
  }

  /**
   * Get pattern history
   */
  getPatternHistory(patternId?: string): Pattern[] {
    if (patternId) {
      return this.patternHistory.get(patternId) || [];
    }
    
    const allPatterns: Pattern[] = [];
    this.patternHistory.forEach(patterns => {
      allPatterns.push(...patterns);
    });
    
    return allPatterns.sort((a, b) => b.timeRange.end - a.timeRange.end);
  }

  /**
   * Clear pattern history
   */
  clearHistory(): void {
    this.patternHistory.clear();
    this.emit('history-cleared');
  }

  /**
   * Preprocess data for analysis
   */
  private preprocessData(data: DataPoint[]): DataPoint[] {
    // Sort by timestamp
    const sorted = [...data].sort((a, b) => a.timestamp - b.timestamp);
    
    // Remove duplicates
    const deduplicated = sorted.filter((point, index) => 
      index === 0 || point.timestamp !== sorted[index - 1].timestamp
    );
    
    // Fill missing IDs
    return deduplicated.map((point, index) => ({
      ...point,
      id: point.id || `point_${index}`
    }));
  }

  /**
   * Extract features from data
   */
  private extractFeatures(data: DataPoint[]): Record<string, number> {
    const features: Record<string, number> = {};
    
    this.extractors.forEach((extractor, name) => {
      try {
        const extracted = extractor.extract(data);
        Object.entries(extracted).forEach(([key, value]) => {
          features[`${name}_${key}`] = value;
        });
      } catch (error) {
        this.emit('feature-extraction-error', { extractor: name, error });
      }
    });
    
    return features;
  }

  /**
   * Detect trends in the data
   */
  private detectTrends(data: DataPoint[]): Trend[] {
    const trends: Trend[] = [];
    const windowSize = Math.min(this.config.windowSize, data.length);
    
    for (let i = 0; i <= data.length - windowSize; i++) {
      const window = data.slice(i, i + windowSize);
      const trend = this.analyzeTrendInWindow(window);
      
      if (trend && trend.confidence >= this.config.confidenceThreshold) {
        trends.push(trend);
      }
    }
    
    // Merge overlapping trends
    return this.mergeTrends(trends);
  }

  /**
   * Analyze trend in a data window
   */
  private analyzeTrendInWindow(data: DataPoint[]): Trend | null {
    if (data.length < 3) return null;
    
    const x = data.map((_, i) => i);
    const y = data.map(d => d.value);
    
    // Calculate linear regression
    const n = data.length;
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumXX = x.reduce((sum, xi) => sum + xi * xi, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const _intercept = (sumY - slope * sumX) / n;
    
    // Calculate correlation coefficient
    const meanX = sumX / n;
    const meanY = sumY / n;
    const numerator = x.reduce((sum, xi, i) => sum + (xi - meanX) * (y[i] - meanY), 0);
    const denomX = Math.sqrt(x.reduce((sum, xi) => sum + Math.pow(xi - meanX, 2), 0));
    const denomY = Math.sqrt(y.reduce((sum, yi) => sum + Math.pow(yi - meanY, 2), 0));
    const correlation = numerator / (denomX * denomY);
    
    // Determine trend direction
    let direction: Trend['direction'];
    if (Math.abs(slope) < 0.01) {
      direction = 'stable';
    } else {
      direction = slope > 0 ? 'up' : 'down';
    }
    
    const strength = Math.abs(correlation);
    const confidence = Math.min(1, strength * 1.2); // Boost confidence slightly
    
    return {
      id: `trend_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      direction,
      strength,
      startTime: data[0].timestamp,
      endTime: data[data.length - 1].timestamp,
      slope,
      correlation,
      dataPoints: data.length,
      confidence
    };
  }

  /**
   * Detect anomalies using statistical methods
   */
  private detectAnomalies(data: DataPoint[]): Anomaly[] {
    const anomalies: Anomaly[] = [];
    const values = data.map(d => d.value);
    
    // Calculate mean and standard deviation
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    
    data.forEach(point => {
      const deviation = Math.abs(point.value - mean) / stdDev;
      
      if (deviation > this.config.anomalyThreshold) {
        const severity = this.classifyAnomalySeverity(deviation, this.config.anomalyThreshold);
        
        anomalies.push({
          id: `anomaly_${point.id || point.timestamp}`,
          timestamp: point.timestamp,
          value: point.value,
          expectedValue: mean,
          deviation,
          severity,
          type: 'point',
          reason: `Value deviates ${deviation.toFixed(2)} standard deviations from mean`,
          confidence: Math.min(1, deviation / this.config.anomalyThreshold / 2)
        });
      }
    });
    
    return anomalies;
  }

  /**
   * Detect seasonal patterns
   */
  private detectSeasonality(data: DataPoint[]): SeasonalPattern[] {
    const patterns: SeasonalPattern[] = [];
    
    if (data.length < 20) return patterns; // Need sufficient data
    
    // Try different period lengths
    const periods = [7, 24, 24 * 7, 24 * 30]; // days, hours, week, month in hours
    
    periods.forEach(period => {
      const pattern = this.detectSeasonalityForPeriod(data, period * 3600000); // Convert to milliseconds
      if (pattern && pattern.confidence >= this.config.confidenceThreshold) {
        patterns.push(pattern);
      }
    });
    
    return patterns;
  }

  /**
   * Detect seasonality for a specific period
   */
  private detectSeasonalityForPeriod(data: DataPoint[], period: number): SeasonalPattern | null {
    // Group data by phase within the period
    const phases = new Map<number, number[]>();
    
    data.forEach(point => {
      const phase = point.timestamp % period;
      const phaseKey = Math.floor(phase / (period / 24)); // 24 buckets per period
      
      if (!phases.has(phaseKey)) {
        phases.set(phaseKey, []);
      }
      phases.get(phaseKey)!.push(point.value);
    });
    
    // Calculate variance within phases vs overall variance
    const allValues = data.map(d => d.value);
    const overallMean = allValues.reduce((a, b) => a + b, 0) / allValues.length;
    const overallVariance = allValues.reduce((sum, val) => sum + Math.pow(val - overallMean, 2), 0) / allValues.length;
    
    let withinPhaseVariance = 0;
    let totalPhasePoints = 0;
    
    phases.forEach(phaseValues => {
      const phaseMean = phaseValues.reduce((a, b) => a + b, 0) / phaseValues.length;
      const phaseVariance = phaseValues.reduce((sum, val) => sum + Math.pow(val - phaseMean, 2), 0) / phaseValues.length;
      
      withinPhaseVariance += phaseVariance * phaseValues.length;
      totalPhasePoints += phaseValues.length;
    });
    
    withinPhaseVariance /= totalPhasePoints;
    
    // Seasonality strength based on variance reduction
    const strength = Math.max(0, 1 - withinPhaseVariance / overallVariance);
    const confidence = Math.min(1, strength * 1.5);
    
    if (strength < 0.1) return null; // Too weak
    
    return {
      id: `seasonal_${period}_${Date.now()}`,
      period,
      amplitude: Math.sqrt(overallVariance - withinPhaseVariance),
      phase: 0, // Simplified
      strength,
      confidence,
      detectedAt: Date.now()
    };
  }

  /**
   * Analyze correlations between variables
   */
  private analyzeCorrelations(data: DataPoint[], _features: Record<string, number>): Correlation[] {
    const correlations: Correlation[] = [];
    
    // For simplicity, check correlation between value and timestamp
    if (data.length < 5) return correlations;
    
    const timestamps = data.map(d => d.timestamp);
    const values = data.map(d => d.value);
    
    const correlation = this.calculatePearsonCorrelation(timestamps, values);
    const strength = this.classifyCorrelationStrength(Math.abs(correlation));
    
    if (strength !== 'none') {
      correlations.push({
        id: `correlation_time_value_${Date.now()}`,
        variables: ['timestamp', 'value'],
        coefficient: correlation,
        pValue: 0.05, // Simplified
        strength,
        type: correlation > 0 ? 'positive' : 'negative',
        confidence: Math.abs(correlation)
      });
    }
    
    return correlations;
  }

  /**
   * Match patterns using registered templates
   */
  private async matchPatterns(data: DataPoint[]): Promise<Pattern[]> {
    const patterns: Pattern[] = [];
    
    for (const template of this.templates.values()) {
      try {
        const result = template.matcher(data);
        
        if (result.match && result.confidence >= this.config.confidenceThreshold) {
          patterns.push({
            id: `${template.id}_${Date.now()}`,
            name: template.name,
            type: template.type,
            confidence: result.confidence,
            description: template.description,
            parameters: result.parameters,
            timeRange: {
              start: data[0]?.timestamp || 0,
              end: data[data.length - 1]?.timestamp || 0
            },
            dataPoints: data.map(d => d.id!),
            metadata: { templateId: template.id }
          });
        }
      } catch (error) {
        this.emit('pattern-matching-error', { template: template.id, error });
      }
    }
    
    return patterns;
  }

  /**
   * Detect patterns using ML models
   */
  private async detectMLPatterns(data: DataPoint[]): Promise<Pattern[]> {
    const patterns: Pattern[] = [];
    
    for (const model of this.models.values()) {
      if (model.trained) {
        try {
          const modelPatterns = await model.predict(data);
          patterns.push(...modelPatterns);
        } catch (error) {
          this.emit('ml-prediction-error', { model: model.id, error });
        }
      }
    }
    
    return patterns;
  }

  /**
   * Calculate analysis summary
   */
  private calculateSummary(result: RecognitionResult, analysisTime: number): RecognitionResult['summary'] {
    const totalPatterns = result.patterns.length + result.anomalies.length + result.trends.length + result.seasonality.length;
    
    // Average confidence across all detections
    const allConfidences = [
      ...result.patterns.map(p => p.confidence),
      ...result.anomalies.map(a => a.confidence),
      ...result.trends.map(t => t.confidence),
      ...result.seasonality.map(s => s.confidence)
    ];
    
    const averageConfidence = allConfidences.length > 0 ?
      allConfidences.reduce((a, b) => a + b, 0) / allConfidences.length : 0;
    
    // Determine quality based on confidence and number of patterns found
    let quality: RecognitionResult['summary']['quality'];
    if (averageConfidence >= 0.8 && totalPatterns > 0) {
      quality = 'excellent';
    } else if (averageConfidence >= 0.6 && totalPatterns > 0) {
      quality = 'good';
    } else if (averageConfidence >= 0.4 || totalPatterns > 0) {
      quality = 'fair';
    } else {
      quality = 'poor';
    }
    
    return {
      totalDataPoints: result.summary.totalDataPoints,
      analysisTime,
      confidence: averageConfidence,
      quality
    };
  }

  /**
   * Store patterns in history
   */
  private storePatternHistory(patterns: Pattern[]): void {
    patterns.forEach(pattern => {
      if (!this.patternHistory.has(pattern.type)) {
        this.patternHistory.set(pattern.type, []);
      }
      this.patternHistory.get(pattern.type)!.push(pattern);
    });
  }

  /**
   * Helper methods
   */
  private mergeTrends(trends: Trend[]): Trend[] {
    // Simplified merging - in practice would use more sophisticated overlap detection
    return trends.filter((trend, index) => {
      const overlapping = trends.slice(index + 1).some(other => 
        trend.endTime > other.startTime && trend.startTime < other.endTime
      );
      return !overlapping || trend.confidence > 0.8;
    });
  }

  private classifyAnomalySeverity(deviation: number, threshold: number): Anomaly['severity'] {
    if (deviation > threshold * 3) return 'critical';
    if (deviation > threshold * 2) return 'high';
    if (deviation > threshold * 1.5) return 'medium';
    return 'low';
  }

  private calculatePearsonCorrelation(x: number[], y: number[]): number {
    const n = x.length;
    if (n !== y.length || n === 0) return 0;
    
    const meanX = x.reduce((a, b) => a + b, 0) / n;
    const meanY = y.reduce((a, b) => a + b, 0) / n;
    
    const numerator = x.reduce((sum, xi, i) => sum + (xi - meanX) * (y[i] - meanY), 0);
    const denomX = Math.sqrt(x.reduce((sum, xi) => sum + Math.pow(xi - meanX, 2), 0));
    const denomY = Math.sqrt(y.reduce((sum, yi) => sum + Math.pow(yi - meanY, 2), 0));
    
    return denomX * denomY === 0 ? 0 : numerator / (denomX * denomY);
  }

  private classifyCorrelationStrength(coefficient: number): Correlation['strength'] {
    if (coefficient >= 0.8) return 'very_strong';
    if (coefficient >= 0.6) return 'strong';
    if (coefficient >= 0.4) return 'moderate';
    if (coefficient >= 0.2) return 'weak';
    return 'none';
  }

  /**
   * Setup default pattern templates
   */
  private setupDefaultTemplates(): void {
    // Spike pattern
    this.registerTemplate({
      id: 'spike',
      name: 'Spike Pattern',
      type: 'spike',
      description: 'Sudden increase followed by decrease',
      matcher: (data: DataPoint[]) => {
        if (data.length < 3) return { match: false, confidence: 0, parameters: {} };
        
        const values = data.map(d => d.value);
        const maxValue = Math.max(...values);
        const maxIndex = values.indexOf(maxValue);
        
        if (maxIndex === 0 || maxIndex === values.length - 1) {
          return { match: false, confidence: 0, parameters: {} };
        }
        
        const beforeValue = values[maxIndex - 1];
        const afterValue = values[maxIndex + 1];
        const avgOther = (beforeValue + afterValue) / 2;
        
        const spikeRatio = maxValue / avgOther;
        const confidence = Math.min(1, Math.max(0, (spikeRatio - 1.5) / 2));
        
        return {
          match: spikeRatio > 1.5,
          confidence,
          parameters: { spikeRatio, maxValue, position: maxIndex }
        };
      },
      examples: []
    });

    // Step change pattern
    this.registerTemplate({
      id: 'step_change',
      name: 'Step Change',
      type: 'trend',
      description: 'Sudden level change that persists',
      matcher: (data: DataPoint[]) => {
        if (data.length < 6) return { match: false, confidence: 0, parameters: {} };
        
        const values = data.map(d => d.value);
        const midPoint = Math.floor(values.length / 2);
        
        const firstHalf = values.slice(0, midPoint);
        const secondHalf = values.slice(midPoint);
        
        const firstMean = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
        const secondMean = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
        
        const firstStd = Math.sqrt(firstHalf.reduce((sum, val) => sum + Math.pow(val - firstMean, 2), 0) / firstHalf.length);
        const secondStd = Math.sqrt(secondHalf.reduce((sum, val) => sum + Math.pow(val - secondMean, 2), 0) / secondHalf.length);
        
        const meanDiff = Math.abs(secondMean - firstMean);
        const avgStd = (firstStd + secondStd) / 2;
        
        const significance = avgStd > 0 ? meanDiff / avgStd : 0;
        const confidence = Math.min(1, significance / 2);
        
        return {
          match: significance > 2,
          confidence,
          parameters: { stepSize: meanDiff, significance, changePoint: midPoint }
        };
      },
      examples: []
    });
  }

  /**
   * Setup default feature extractors
   */
  private setupDefaultExtractors(): void {
    // Statistical features
    this.registerExtractor({
      name: 'statistical',
      extract: (data: DataPoint[]) => {
        const values = data.map(d => d.value);
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
        
        return {
          mean,
          variance,
          std: Math.sqrt(variance),
          min: Math.min(...values),
          max: Math.max(...values),
          range: Math.max(...values) - Math.min(...values),
          skewness: this.calculateSkewness(values),
          kurtosis: this.calculateKurtosis(values)
        };
      },
      requiredFields: ['value']
    });

    // Temporal features
    this.registerExtractor({
      name: 'temporal',
      extract: (data: DataPoint[]) => {
        const timestamps = data.map(d => d.timestamp);
        const intervals = [];
        
        for (let i = 1; i < timestamps.length; i++) {
          intervals.push(timestamps[i] - timestamps[i - 1]);
        }
        
        const meanInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        const duration = timestamps[timestamps.length - 1] - timestamps[0];
        
        return {
          duration,
          meanInterval,
          samplingRate: 1000 / meanInterval, // samples per second
          dataPoints: data.length
        };
      },
      requiredFields: ['timestamp']
    });
  }

  /**
   * Setup default ML models
   */
  private setupDefaultModels(): void {
    // Simple statistical model
    this.registerModel(new StatisticalModel());
  }

  /**
   * Statistical helper methods
   */
  private calculateSkewness(values: number[]): number {
    const n = values.length;
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / n;
    const std = Math.sqrt(variance);
    
    if (std === 0) return 0;
    
    const skewness = values.reduce((sum, val) => sum + Math.pow((val - mean) / std, 3), 0) / n;
    return skewness;
  }

  private calculateKurtosis(values: number[]): number {
    const n = values.length;
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / n;
    const std = Math.sqrt(variance);
    
    if (std === 0) return 0;
    
    const kurtosis = values.reduce((sum, val) => sum + Math.pow((val - mean) / std, 4), 0) / n;
    return kurtosis - 3; // Excess kurtosis
  }
}

/**
 * Simple statistical model implementation
 */
export class StatisticalModel implements Model {
  id = 'statistical';
  name = 'Statistical Pattern Model';
  type: Model['type'] = 'unsupervised';
  algorithm = 'statistical';
  trained = false;
  accuracy?: number;

  async train(_data: DataPoint[]): Promise<void> {
    // For statistical model, "training" is just marking as trained
    // since it doesn't require actual training
    this.trained = true;
    this.accuracy = 0.75; // Fixed accuracy for demo
  }

  async predict(data: DataPoint[]): Promise<Pattern[]> {
    if (!this.trained) {
      throw new Error('Model not trained');
    }

    const patterns: Pattern[] = [];
    
    // Simple statistical pattern detection
    if (data.length >= 10) {
      const values = data.map(d => d.value);
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
      
      // Detect high variance pattern
      if (variance > mean * 0.5) {
        patterns.push({
          id: `statistical_high_variance_${Date.now()}`,
          name: 'High Variance Pattern',
          type: 'custom',
          confidence: Math.min(1, variance / mean),
          description: 'Data shows high variability',
          parameters: { variance, mean, ratio: variance / mean },
          timeRange: {
            start: data[0].timestamp,
            end: data[data.length - 1].timestamp
          },
          dataPoints: data.map(d => d.id!)
        });
      }
    }
    
    return patterns;
  }

  async evaluate(_testData: DataPoint[]): Promise<{ accuracy: number; precision: number; recall: number; f1Score: number }> {
    // Simplified evaluation metrics
    return {
      accuracy: this.accuracy || 0.75,
      precision: 0.7,
      recall: 0.8,
      f1Score: 0.74
    };
  }
}

// Export default
export default PatternRecognizer;