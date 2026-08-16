"""Context-type resolvers. Each returns a ContextSection.

Bounded contract: a resolver MUST NOT fetch anything outside its declared type.
This is what keeps context packages small and deterministic.
"""
from __future__ import annotations

from typing import Callable, Dict

from ..models import ContextType
from . import (
    architecture_decisions,
    code_snippets,
    domain_events,
    nfrs,
    patterns,
    product_scope,
    related_stories,
    test_specs,
    vision_spec,
)

RESOLVERS: Dict[ContextType, Callable] = {
    ContextType.VISION_SPEC: vision_spec.resolve,
    ContextType.PRODUCT_SCOPE: product_scope.resolve,
    ContextType.ARCHITECTURE_DECISIONS: architecture_decisions.resolve,
    ContextType.RELATED_STORIES: related_stories.resolve,
    ContextType.CODE_SNIPPETS: code_snippets.resolve,
    ContextType.TEST_SPECS: test_specs.resolve,
    ContextType.NFRS: nfrs.resolve,
    ContextType.PATTERNS: patterns.resolve,
    ContextType.DOMAIN_EVENTS: domain_events.resolve,
}
