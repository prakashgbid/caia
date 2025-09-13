
import neo4j from 'neo4j-driver';
import { EventEmitter } from 'events';

export class GraphManager extends EventEmitter {
  private driver: any;
  private session: any;
  private cache: Map<string, any>;

  constructor() {
    super();
    this.cache = new Map();
  }

  async connect(uri: string, user: string, password: string) {
    this.driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
    this.session = this.driver.session();
    this.emit('connected');
    return true;
  }

  async createNode(nodeType: string, properties: any) {
    const query = `
      CREATE (n:${nodeType})
      SET n = $properties
      RETURN n
    `;
    const result = await this.session.run(query, { properties });
    return result.records[0].get('n');
  }

  async createRelationship(node1Id: string, node2Id: string, relType: string, properties?: any) {
    const query = `
      MATCH (a), (b)
      WHERE id(a) = $node1Id AND id(b) = $node2Id
      CREATE (a)-[r:${relType}]->(b)
      SET r = $properties
      RETURN r
    `;
    const result = await this.session.run(query, { node1Id, node2Id, properties: properties || {} });
    return result.records[0].get('r');
  }

  async findPath(startNodeId: string, endNodeId: string) {
    const query = `
      MATCH path = shortestPath((start)-[*]-(end))
      WHERE id(start) = $startNodeId AND id(end) = $endNodeId
      RETURN path
    `;
    const result = await this.session.run(query, { startNodeId, endNodeId });
    return result.records.map(record => record.get('path'));
  }

  async query(cypherQuery: string, params?: any) {
    const result = await this.session.run(cypherQuery, params);
    return result.records;
  }

  async close() {
    await this.session.close();
    await this.driver.close();
    this.emit('disconnected');
  }
}
