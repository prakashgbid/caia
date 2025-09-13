
import { GraphManager } from '../core/graph_manager';

export class InferenceEngine {
  private graph: GraphManager;
  private rules: Map<string, Function>;

  constructor(graphManager: GraphManager) {
    this.graph = graphManager;
    this.rules = new Map();
    this.initializeRules();
  }

  private initializeRules() {
    // Rule: If A depends on B and B depends on C, then A transitively depends on C
    this.rules.set('transitive_dependency', async () => {
      const query = `
        MATCH (a)-[:DEPENDS_ON]->(b)-[:DEPENDS_ON]->(c)
        WHERE NOT EXISTS((a)-[:DEPENDS_ON]->(c))
        CREATE (a)-[:TRANSITIVE_DEPENDENCY]->(c)
        RETURN count(*) as created
      `;
      return await this.graph.query(query);
    });

    // Rule: If multiple entities reference the same resource, they're related
    this.rules.set('shared_resource', async () => {
      const query = `
        MATCH (a)-[:USES]->(resource)<-[:USES]-(b)
        WHERE id(a) < id(b) AND NOT EXISTS((a)-[:SHARES_RESOURCE_WITH]->(b))
        CREATE (a)-[:SHARES_RESOURCE_WITH]->(b)
        RETURN count(*) as created
      `;
      return await this.graph.query(query);
    });
  }

  async inferRelationships() {
    const results = [];
    for (const [ruleName, ruleFunc] of this.rules) {
      const result = await ruleFunc();
      results.push({ rule: ruleName, result });
    }
    return results;
  }

  async detectPatterns() {
    const patterns = [];

    // Detect circular dependencies
    const circularQuery = `
      MATCH path = (n)-[:DEPENDS_ON*]->(n)
      RETURN path LIMIT 10
    `;
    const circular = await this.graph.query(circularQuery);
    if (circular.length > 0) {
      patterns.push({ type: 'circular_dependency', instances: circular });
    }

    // Detect hub nodes (highly connected)
    const hubQuery = `
      MATCH (n)
      WITH n, count{(n)--()}  as degree
      WHERE degree > 10
      RETURN n, degree
      ORDER BY degree DESC
      LIMIT 10
    `;
    const hubs = await this.graph.query(hubQuery);
    if (hubs.length > 0) {
      patterns.push({ type: 'hub_nodes', instances: hubs });
    }

    return patterns;
  }

  async recommendConnections() {
    // Find nodes that should probably be connected based on similarity
    const query = `
      MATCH (a), (b)
      WHERE id(a) < id(b)
        AND NOT EXISTS((a)--(b))
        AND size([(a)--() | 1]) > 0
        AND size([(b)--() | 1]) > 0
      WITH a, b,
        [x IN [(a)--()  | id(endNode(x))] | x] AS a_neighbors,
        [x IN [(b)--()  | id(endNode(x))] | x] AS b_neighbors
      WITH a, b,
        size([x IN a_neighbors WHERE x IN b_neighbors | 1]) AS common
      WHERE common > 2
      RETURN a, b, common
      ORDER BY common DESC
      LIMIT 10
    `;

    return await this.graph.query(query);
  }
}
