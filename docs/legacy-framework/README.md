# Framework

Cross-project ADRs, shared configuration, and release tooling for the PokerZeno multi-site platform.

This repo is the single source of truth for architectural decisions that apply to every site in the ecosystem (poker-zeno, roulette-community, and future sites). It owns the `new-site` scaffold script, enforced lock files (accessibility, brand, domains, testing), and CI configuration templates. All sites are expected to remain compatible with the decisions recorded here; deviations require a new ADR filed in `adrs/`.
