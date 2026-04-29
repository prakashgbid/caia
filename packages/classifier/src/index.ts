export {
  classify,
  classifyKeyword,
  type ClassificationResult,
  type ClassifierConfig,
} from './classifier';

export {
  FUNCTIONAL_DOMAINS,
  NATURE_KEYWORDS,
  type DomainDefinition,
  type NatureLabel,
  type ComplexityLabel,
  type LayerLabel,
  type LifecycleLabel,
  type ImpactLabel,
} from './taxonomy';

// BUCKET-002 — taxonomy classifiers consumed by PO Agent.
export {
  classifyProject,
  classifyBusinessSubDomains,
  classifyLifecycle,
  classifyPriority,
  type ProjectClassification,
} from './taxonomy-classifier';
