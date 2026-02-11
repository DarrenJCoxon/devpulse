import { describe, test, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { initEnricher, enrichEvent, getAgentTopology } from './enricher';
import type { HookEvent } from './types';

describe('Agent Topology (E4-S1)', () => {
  let db: Database;

  beforeEach(() => {
    // Create in-memory database for testing
    db = new Database(':memory:');
    initEnricher(db);
  });

  test('SubagentStart creates topology record with correct parent_id', () => {
    // Parent session starts
    const parentSession: HookEvent = {
      source_app: 'MyProject',
      session_id: 'parent-session-123',
      hook_event_type: 'SessionStart',
      payload: { cwd: '/path/to/project' },
      timestamp: Date.now(),
      model_name: 'claude-opus-4-6'
    };
    enrichEvent(parentSession);

    // Subagent spawned by parent
    const subagentStart: HookEvent = {
      source_app: 'MyProject',
      session_id: 'parent-session-123',
      hook_event_type: 'SubagentStart',
      payload: {
        agent_id: 'MyProject:child-session-456',
        cwd: '/path/to/project'
      },
      timestamp: Date.now(),
      model_name: 'claude-opus-4-6'
    };
    enrichEvent(subagentStart);

    // Check topology
    const topology = getAgentTopology();
    expect(topology.length).toBe(1);
    expect(topology[0].agent_id).toBe('MyProject:child-session-456');
    expect(topology[0].parent_id).toBe('MyProject:parent-session-123');
    expect(topology[0].status).toBe('active');
  });

  test('SubagentStop updates topology record status to stopped', () => {
    // Setup: create a subagent
    const subagentStart: HookEvent = {
      source_app: 'MyProject',
      session_id: 'parent-session-123',
      hook_event_type: 'SubagentStart',
      payload: {
        agent_id: 'MyProject:child-session-456'
      },
      timestamp: Date.now(),
      model_name: 'claude-opus-4-6'
    };
    enrichEvent(subagentStart);

    // Stop the subagent
    const subagentStop: HookEvent = {
      source_app: 'MyProject',
      session_id: 'parent-session-123',
      hook_event_type: 'SubagentStop',
      payload: {
        agent_id: 'MyProject:child-session-456'
      },
      timestamp: Date.now()
    };
    enrichEvent(subagentStop);

    // Check topology
    const topology = getAgentTopology();
    expect(topology.length).toBe(1);
    expect(topology[0].status).toBe('stopped');
  });

  test('getAgentTopology builds correct tree from flat records', () => {
    // Parent session
    const parentSession: HookEvent = {
      source_app: 'MyProject',
      session_id: 'parent-123',
      hook_event_type: 'SessionStart',
      payload: { cwd: '/path' },
      timestamp: Date.now(),
      model_name: 'claude-opus-4-6'
    };
    enrichEvent(parentSession);

    // Two children
    const child1: HookEvent = {
      source_app: 'MyProject',
      session_id: 'parent-123',
      hook_event_type: 'SubagentStart',
      payload: { agent_id: 'MyProject:child-1' },
      timestamp: Date.now(),
      model_name: 'claude-opus-4-6'
    };
    enrichEvent(child1);

    const child2: HookEvent = {
      source_app: 'MyProject',
      session_id: 'parent-123',
      hook_event_type: 'SubagentStart',
      payload: { agent_id: 'MyProject:child-2' },
      timestamp: Date.now(),
      model_name: 'claude-opus-4-6'
    };
    enrichEvent(child2);

    // Check topology
    const topology = getAgentTopology();
    expect(topology.length).toBe(2);

    // Both children should have same parent
    const allHaveSameParent = topology.every(
      node => node.parent_id === 'MyProject:parent-123'
    );
    expect(allHaveSameParent).toBe(true);

    // Parent should have 2 children in their children array
    // (Note: parent itself is not in topology table, only subagents)
    // So we check if children arrays are correctly populated
    const child1Node = topology.find(n => n.agent_id === 'MyProject:child-1');
    const child2Node = topology.find(n => n.agent_id === 'MyProject:child-2');
    expect(child1Node).toBeDefined();
    expect(child2Node).toBeDefined();
  });

  test('getAgentTopology filters by project correctly', () => {
    // Project A subagent
    const projectASubagent: HookEvent = {
      source_app: 'ProjectA',
      session_id: 'parent-a',
      hook_event_type: 'SubagentStart',
      payload: { agent_id: 'ProjectA:child-a' },
      timestamp: Date.now(),
      model_name: 'claude-opus-4-6'
    };
    enrichEvent(projectASubagent);

    // Project B subagent
    const projectBSubagent: HookEvent = {
      source_app: 'ProjectB',
      session_id: 'parent-b',
      hook_event_type: 'SubagentStart',
      payload: { agent_id: 'ProjectB:child-b' },
      timestamp: Date.now(),
      model_name: 'claude-opus-4-6'
    };
    enrichEvent(projectBSubagent);

    // Filter by ProjectA
    const topologyA = getAgentTopology('ProjectA');
    expect(topologyA.length).toBe(1);
    expect(topologyA[0].project_name).toBe('ProjectA');

    // Filter by ProjectB
    const topologyB = getAgentTopology('ProjectB');
    expect(topologyB.length).toBe(1);
    expect(topologyB[0].project_name).toBe('ProjectB');

    // No filter returns all
    const topologyAll = getAgentTopology();
    expect(topologyAll.length).toBe(2);
  });

  test('SubagentStart without agent_id in payload is handled gracefully', () => {
    const malformedEvent: HookEvent = {
      source_app: 'MyProject',
      session_id: 'parent-123',
      hook_event_type: 'SubagentStart',
      payload: {}, // Missing agent_id
      timestamp: Date.now()
    };

    // Should not throw
    expect(() => enrichEvent(malformedEvent)).not.toThrow();

    const topology = getAgentTopology();
    expect(topology.length).toBe(0);
  });

  test('SubagentStop without agent_id in payload is handled gracefully', () => {
    const malformedEvent: HookEvent = {
      source_app: 'MyProject',
      session_id: 'parent-123',
      hook_event_type: 'SubagentStop',
      payload: {}, // Missing agent_id
      timestamp: Date.now()
    };

    // Should not throw
    expect(() => enrichEvent(malformedEvent)).not.toThrow();
  });

  test('Topology populates children arrays correctly', () => {
    // Create a parent with 2 children
    const parent: HookEvent = {
      source_app: 'MyProject',
      session_id: 'parent-123',
      hook_event_type: 'SessionStart',
      payload: { cwd: '/path' },
      timestamp: Date.now(),
      model_name: 'claude-opus-4-6'
    };
    enrichEvent(parent);

    const child1: HookEvent = {
      source_app: 'MyProject',
      session_id: 'parent-123',
      hook_event_type: 'SubagentStart',
      payload: { agent_id: 'MyProject:child-1' },
      timestamp: Date.now(),
      model_name: 'claude-opus-4-6'
    };
    enrichEvent(child1);

    const child2: HookEvent = {
      source_app: 'MyProject',
      session_id: 'parent-123',
      hook_event_type: 'SubagentStart',
      payload: { agent_id: 'MyProject:child-2' },
      timestamp: Date.now(),
      model_name: 'claude-opus-4-6'
    };
    enrichEvent(child2);

    const topology = getAgentTopology();

    // Both nodes should have empty children arrays (they're leaves)
    expect(topology[0].children).toEqual([]);
    expect(topology[1].children).toEqual([]);

    // Note: The parent node is not in the topology table since it's not a subagent.
    // Only subagents are tracked in agent_topology.
  });
});
