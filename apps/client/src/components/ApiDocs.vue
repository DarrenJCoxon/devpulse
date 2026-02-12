<template>
  <div class="h-full overflow-y-auto bg-[var(--theme-bg-secondary)]">
    <div class="max-w-7xl mx-auto p-6">
      <!-- Header -->
      <div class="mb-8">
        <h1 class="text-3xl font-bold text-[var(--theme-text-primary)] mb-2">
          API Documentation
        </h1>
        <p class="text-[var(--theme-text-secondary)]">
          Version {{ apiDocumentation.version }} | Base URL: <code class="text-xs bg-[var(--theme-bg-tertiary)] px-2 py-1 rounded">{{ apiDocumentation.baseUrl }}</code>
        </p>
      </div>

      <!-- Search -->
      <div class="mb-6">
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Search endpoints..."
          class="w-full px-4 py-2 bg-[var(--theme-bg-primary)] border border-[var(--theme-border-primary)] rounded-lg text-[var(--theme-text-primary)] placeholder-[var(--theme-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-primary)]"
        />
      </div>

      <!-- Tabs -->
      <div class="mb-6 border-b border-[var(--theme-border-primary)]">
        <div class="flex space-x-4">
          <button
            @click="activeTab = 'rest'"
            class="px-4 py-2 font-medium transition-colors"
            :class="activeTab === 'rest'
              ? 'text-[var(--theme-primary)] border-b-2 border-[var(--theme-primary)]'
              : 'text-[var(--theme-text-tertiary)] hover:text-[var(--theme-text-secondary)]'"
          >
            REST API
          </button>
          <button
            @click="activeTab = 'websocket'"
            class="px-4 py-2 font-medium transition-colors"
            :class="activeTab === 'websocket'
              ? 'text-[var(--theme-primary)] border-b-2 border-[var(--theme-primary)]'
              : 'text-[var(--theme-text-tertiary)] hover:text-[var(--theme-text-secondary)]'"
          >
            WebSocket
          </button>
        </div>
      </div>

      <!-- REST API Endpoints -->
      <div v-if="activeTab === 'rest'" class="space-y-6">
        <div
          v-for="endpoint in filteredEndpoints"
          :key="`${endpoint.method}-${endpoint.path}`"
          class="bg-[var(--theme-bg-primary)] border border-[var(--theme-border-primary)] rounded-lg overflow-hidden"
        >
          <!-- Endpoint Header -->
          <div class="p-4 border-b border-[var(--theme-border-primary)]">
            <div class="flex items-center space-x-3">
              <span
                class="px-3 py-1 rounded-md text-sm font-bold"
                :class="getMethodClass(endpoint.method)"
              >
                {{ endpoint.method }}
              </span>
              <code class="text-sm font-mono text-[var(--theme-text-primary)]">
                {{ endpoint.path }}
              </code>
            </div>
            <p class="mt-2 text-sm text-[var(--theme-text-secondary)]">
              {{ endpoint.description }}
            </p>
          </div>

          <!-- Endpoint Details -->
          <div class="p-4 space-y-4">
            <!-- Parameters -->
            <div v-if="endpoint.parameters && endpoint.parameters.length > 0">
              <h4 class="text-sm font-semibold text-[var(--theme-text-primary)] mb-2">
                Parameters
              </h4>
              <div class="overflow-x-auto">
                <table class="w-full text-sm">
                  <thead class="bg-[var(--theme-bg-tertiary)]">
                    <tr>
                      <th class="px-3 py-2 text-left text-[var(--theme-text-secondary)]">Name</th>
                      <th class="px-3 py-2 text-left text-[var(--theme-text-secondary)]">Type</th>
                      <th class="px-3 py-2 text-left text-[var(--theme-text-secondary)]">Required</th>
                      <th class="px-3 py-2 text-left text-[var(--theme-text-secondary)]">Location</th>
                      <th class="px-3 py-2 text-left text-[var(--theme-text-secondary)]">Description</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-[var(--theme-border-primary)]">
                    <tr v-for="param in endpoint.parameters" :key="param.name">
                      <td class="px-3 py-2 font-mono text-[var(--theme-text-primary)]">{{ param.name }}</td>
                      <td class="px-3 py-2 font-mono text-[var(--theme-text-secondary)]">{{ param.type }}</td>
                      <td class="px-3 py-2">
                        <span
                          class="px-2 py-0.5 rounded text-xs font-medium"
                          :class="param.required
                            ? 'bg-red-500/20 text-red-400'
                            : 'bg-gray-500/20 text-gray-400'"
                        >
                          {{ param.required ? 'Required' : 'Optional' }}
                        </span>
                      </td>
                      <td class="px-3 py-2 text-[var(--theme-text-secondary)]">{{ param.location }}</td>
                      <td class="px-3 py-2 text-[var(--theme-text-secondary)]">{{ param.description }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Request Body -->
            <div v-if="endpoint.requestBody">
              <h4 class="text-sm font-semibold text-[var(--theme-text-primary)] mb-2">
                Request Body
              </h4>
              <div class="space-y-2">
                <p class="text-xs text-[var(--theme-text-tertiary)]">
                  Content-Type: <code>{{ endpoint.requestBody.contentType }}</code>
                </p>
                <div class="bg-[var(--theme-bg-tertiary)] p-3 rounded-lg overflow-x-auto">
                  <pre class="text-xs font-mono text-[var(--theme-text-primary)]">{{ endpoint.requestBody.schema }}</pre>
                </div>
                <details class="text-xs">
                  <summary class="cursor-pointer text-[var(--theme-primary)] hover:underline">
                    Show example
                  </summary>
                  <div class="mt-2 bg-[var(--theme-bg-tertiary)] p-3 rounded-lg overflow-x-auto">
                    <pre class="text-xs font-mono text-[var(--theme-text-primary)]">{{ endpoint.requestBody.example }}</pre>
                  </div>
                </details>
              </div>
            </div>

            <!-- Response -->
            <div>
              <h4 class="text-sm font-semibold text-[var(--theme-text-primary)] mb-2">
                Response ({{ endpoint.response.status }})
              </h4>
              <div class="space-y-2">
                <div class="bg-[var(--theme-bg-tertiary)] p-3 rounded-lg overflow-x-auto">
                  <pre class="text-xs font-mono text-[var(--theme-text-primary)]">{{ endpoint.response.schema }}</pre>
                </div>
                <details class="text-xs">
                  <summary class="cursor-pointer text-[var(--theme-primary)] hover:underline">
                    Show example
                  </summary>
                  <div class="mt-2 bg-[var(--theme-bg-tertiary)] p-3 rounded-lg overflow-x-auto">
                    <pre class="text-xs font-mono text-[var(--theme-text-primary)]">{{ endpoint.response.example }}</pre>
                  </div>
                </details>
              </div>
            </div>
          </div>
        </div>

        <div v-if="filteredEndpoints.length === 0" class="text-center py-12 text-[var(--theme-text-tertiary)]">
          No endpoints match your search
        </div>
      </div>

      <!-- WebSocket Messages -->
      <div v-if="activeTab === 'websocket'" class="space-y-6">
        <!-- WebSocket URL -->
        <div class="bg-[var(--theme-bg-primary)] border border-[var(--theme-border-primary)] rounded-lg p-4">
          <h3 class="text-lg font-semibold text-[var(--theme-text-primary)] mb-2">
            WebSocket Endpoint
          </h3>
          <code class="text-sm bg-[var(--theme-bg-tertiary)] px-3 py-2 rounded">
            {{ apiDocumentation.websocket.url }}
          </code>
        </div>

        <!-- Message Types -->
        <div
          v-for="message in filteredMessages"
          :key="message.type"
          class="bg-[var(--theme-bg-primary)] border border-[var(--theme-border-primary)] rounded-lg overflow-hidden"
        >
          <!-- Message Header -->
          <div class="p-4 border-b border-[var(--theme-border-primary)]">
            <div class="flex items-center space-x-3">
              <span class="px-3 py-1 rounded-md text-sm font-bold bg-purple-500/20 text-purple-400">
                {{ message.type }}
              </span>
            </div>
            <p class="mt-2 text-sm text-[var(--theme-text-secondary)]">
              {{ message.description }}
            </p>
          </div>

          <!-- Message Details -->
          <div class="p-4 space-y-4">
            <!-- Data Shape -->
            <div>
              <h4 class="text-sm font-semibold text-[var(--theme-text-primary)] mb-2">
                Data Shape
              </h4>
              <div class="bg-[var(--theme-bg-tertiary)] p-3 rounded-lg overflow-x-auto">
                <pre class="text-xs font-mono text-[var(--theme-text-primary)]">{{ message.dataShape }}</pre>
              </div>
            </div>

            <!-- Example -->
            <div>
              <h4 class="text-sm font-semibold text-[var(--theme-text-primary)] mb-2">
                Example
              </h4>
              <div class="bg-[var(--theme-bg-tertiary)] p-3 rounded-lg overflow-x-auto">
                <pre class="text-xs font-mono text-[var(--theme-text-primary)]">{{ message.example }}</pre>
              </div>
            </div>
          </div>
        </div>

        <div v-if="filteredMessages.length === 0" class="text-center py-12 text-[var(--theme-text-tertiary)]">
          No messages match your search
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { apiDocumentation } from '../data/apiDocs';

const activeTab = ref<'rest' | 'websocket'>('rest');
const searchQuery = ref('');

const filteredEndpoints = computed(() => {
  if (!searchQuery.value.trim()) {
    return apiDocumentation.endpoints;
  }

  const query = searchQuery.value.toLowerCase();
  return apiDocumentation.endpoints.filter(endpoint => {
    return (
      endpoint.method.toLowerCase().includes(query) ||
      endpoint.path.toLowerCase().includes(query) ||
      endpoint.description.toLowerCase().includes(query)
    );
  });
});

const filteredMessages = computed(() => {
  if (!searchQuery.value.trim()) {
    return apiDocumentation.websocket.messages;
  }

  const query = searchQuery.value.toLowerCase();
  return apiDocumentation.websocket.messages.filter(message => {
    return (
      message.type.toLowerCase().includes(query) ||
      message.description.toLowerCase().includes(query)
    );
  });
});

const getMethodClass = (method: string): string => {
  const classes = {
    GET: 'bg-green-500/20 text-green-400',
    POST: 'bg-blue-500/20 text-blue-400',
    PUT: 'bg-amber-500/20 text-amber-400',
    DELETE: 'bg-red-500/20 text-red-400'
  };
  return classes[method as keyof typeof classes] || 'bg-gray-500/20 text-gray-400';
};
</script>
