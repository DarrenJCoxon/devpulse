<template>
  <div
    v-if="isOpen"
    class="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
    @click.self="handleClose"
  >
    <div class="bg-[var(--theme-bg-primary)] rounded-lg shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden border border-[var(--theme-border-primary)]">
      <!-- Header -->
      <div class="flex items-center justify-between p-4 border-b border-[var(--theme-border-primary)]">
        <h2 class="text-xl font-bold text-[var(--theme-text-primary)]">Add Project to DevPulse</h2>
        <button
          @click="handleClose"
          class="p-2 rounded-lg hover:bg-[var(--theme-hover-bg)] transition-colors"
          title="Close"
        >
          <span class="text-2xl">✕</span>
        </button>
      </div>

      <!-- Step Indicator -->
      <div class="flex items-center justify-center gap-2 p-4 border-b border-[var(--theme-border-secondary)]">
        <div
          v-for="step in 3"
          :key="step"
          class="flex items-center"
        >
          <div
            class="w-8 h-8 rounded-full flex items-center justify-center font-semibold text-sm transition-colors"
            :class="currentStep === step
              ? 'bg-[var(--theme-primary)] text-white'
              : currentStep > step
                ? 'bg-green-500 text-white'
                : 'bg-[var(--theme-bg-tertiary)] text-[var(--theme-text-tertiary)]'"
          >
            <span v-if="currentStep > step">✓</span>
            <span v-else>{{ step }}</span>
          </div>
          <div
            v-if="step < 3"
            class="w-16 h-1 mx-2 rounded transition-colors"
            :class="currentStep > step ? 'bg-green-500' : 'bg-[var(--theme-bg-tertiary)]'"
          ></div>
        </div>
      </div>

      <!-- Content -->
      <div class="p-6 overflow-y-auto max-h-[60vh]">
        <!-- Step 1: Form -->
        <div v-if="currentStep === 1" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-[var(--theme-text-secondary)] mb-2">
              Project Path
            </label>
            <input
              v-model="formData.projectPath"
              @blur="validatePath"
              type="text"
              placeholder="/Users/you/Documents/myproject"
              class="w-full px-3 py-2 bg-[var(--theme-bg-secondary)] border border-[var(--theme-border-primary)] rounded-lg text-[var(--theme-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-primary)]"
            />
            <p
              v-if="validation.pathError"
              class="text-sm text-[var(--theme-accent-error)] mt-1"
            >
              {{ validation.pathError }}
            </p>
            <p
              v-else-if="validation.pathWarning"
              class="text-sm text-[var(--theme-accent-warning)] mt-1"
            >
              {{ validation.pathWarning }}
            </p>
            <p
              v-else-if="validation.isValidating"
              class="text-sm text-[var(--theme-text-tertiary)] mt-1"
            >
              Validating...
            </p>
            <p
              v-else-if="validation.isValid"
              class="text-sm text-[var(--theme-accent-success)] mt-1"
            >
              ✓ Valid directory
            </p>
          </div>

          <div>
            <label class="block text-sm font-medium text-[var(--theme-text-secondary)] mb-2">
              Project Name
            </label>
            <input
              v-model="formData.projectName"
              type="text"
              placeholder="MyProject"
              class="w-full px-3 py-2 bg-[var(--theme-bg-secondary)] border border-[var(--theme-border-primary)] rounded-lg text-[var(--theme-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-primary)]"
            />
            <p class="text-xs text-[var(--theme-text-tertiary)] mt-1">
              This name will appear in the DevPulse dashboard
            </p>
          </div>
        </div>

        <!-- Step 2: Preview -->
        <div v-if="currentStep === 2" class="space-y-4">
          <div class="bg-[var(--theme-bg-secondary)] rounded-lg p-4 border border-[var(--theme-border-secondary)]">
            <h3 class="text-sm font-semibold text-[var(--theme-text-primary)] mb-3">Installation Preview</h3>
            <div class="space-y-2 text-sm text-[var(--theme-text-secondary)]">
              <div class="flex items-start gap-2">
                <span class="text-green-500">✓</span>
                <div>
                  <p class="font-medium">Copy hook scripts to:</p>
                  <code class="text-xs font-mono bg-[var(--theme-bg-tertiary)] px-2 py-1 rounded mt-1 block">
                    {{ formData.projectPath }}/.claude/hooks/
                  </code>
                </div>
              </div>
              <div class="flex items-start gap-2">
                <span class="text-green-500">✓</span>
                <div>
                  <p class="font-medium">Create/update settings file:</p>
                  <code class="text-xs font-mono bg-[var(--theme-bg-tertiary)] px-2 py-1 rounded mt-1 block">
                    {{ formData.projectPath }}/.claude/settings.json
                  </code>
                </div>
              </div>
              <div class="flex items-start gap-2">
                <span class="text-green-500">✓</span>
                <div>
                  <p class="font-medium">Configure project name:</p>
                  <code class="text-xs font-mono bg-[var(--theme-bg-tertiary)] px-2 py-1 rounded mt-1 block">
                    {{ formData.projectName }}
                  </code>
                </div>
              </div>
              <div class="flex items-start gap-2">
                <span class="text-green-500">✓</span>
                <div>
                  <p class="font-medium">Point hooks to DevPulse server:</p>
                  <code class="text-xs font-mono bg-[var(--theme-bg-tertiary)] px-2 py-1 rounded mt-1 block">
                    {{ serverUrl }}
                  </code>
                </div>
              </div>
            </div>
          </div>

          <div
            v-if="validation.pathWarning"
            class="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800"
          >
            <p class="font-semibold mb-1">⚠️ Warning</p>
            <p>{{ validation.pathWarning }}</p>
            <p class="mt-2">A backup will be created at <code class="font-mono bg-yellow-100 px-1">.claude/settings.json.backup</code></p>
          </div>
        </div>

        <!-- Step 3: Progress -->
        <div v-if="currentStep === 3" class="space-y-4">
          <div
            v-if="installation.status === 'running'"
            class="flex items-center gap-3 text-[var(--theme-text-secondary)]"
          >
            <div class="animate-spin w-5 h-5 border-2 border-[var(--theme-primary)] border-t-transparent rounded-full"></div>
            <span>Installing hooks...</span>
          </div>

          <div
            v-if="installation.output"
            class="bg-[var(--theme-bg-tertiary)] font-mono text-xs p-3 rounded-lg max-h-64 overflow-y-auto border border-[var(--theme-border-secondary)]"
          >
            <pre class="whitespace-pre-wrap text-[var(--theme-text-secondary)]">{{ installation.output }}</pre>
          </div>

          <div
            v-if="installation.status === 'success'"
            class="bg-green-50 border border-green-200 rounded-lg p-4"
          >
            <div class="flex items-center gap-2 text-green-700 font-semibold mb-2">
              <span class="text-xl">✓</span>
              <span>Installation Successful!</span>
            </div>
            <p class="text-sm text-green-600">
              Hooks have been installed. You can now start Claude Code in this project.
            </p>
          </div>

          <div
            v-if="installation.status === 'error'"
            class="bg-red-50 border border-red-200 rounded-lg p-4"
          >
            <div class="flex items-center gap-2 text-red-700 font-semibold mb-2">
              <span class="text-xl">✕</span>
              <span>Installation Failed</span>
            </div>
            <p class="text-sm text-red-600">
              {{ installation.error }}
            </p>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="flex items-center justify-between p-4 border-t border-[var(--theme-border-primary)]">
        <button
          v-if="currentStep > 1 && installation.status !== 'running'"
          @click="handleBack"
          class="px-4 py-2 rounded-lg bg-[var(--theme-bg-secondary)] text-[var(--theme-text-primary)] hover:bg-[var(--theme-hover-bg)] transition-colors border border-[var(--theme-border-primary)]"
        >
          Back
        </button>
        <div v-else></div>

        <div class="flex items-center gap-2">
          <button
            v-if="installation.status === 'success'"
            @click="handleTestEvent"
            :disabled="testEvent.status === 'sending'"
            class="px-4 py-2 rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span v-if="testEvent.status === 'sending'">Sending...</span>
            <span v-else-if="testEvent.status === 'sent'">✓ Test Event Sent</span>
            <span v-else>Send Test Event</span>
          </button>

          <button
            v-if="currentStep < 3"
            @click="handleNext"
            :disabled="!canProceed"
            class="px-4 py-2 rounded-lg bg-[var(--theme-primary)] text-white hover:bg-[var(--theme-primary-dark)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {{ currentStep === 2 ? 'Install' : 'Next' }}
          </button>

          <button
            v-if="installation.status === 'success' || installation.status === 'error'"
            @click="handleClose"
            class="px-4 py-2 rounded-lg bg-[var(--theme-primary)] text-white hover:bg-[var(--theme-primary-dark)] transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { API_URL } from '../config';

defineProps<{
  isOpen: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const currentStep = ref(1);
const formData = ref({
  projectPath: '',
  projectName: ''
});

const validation = ref({
  isValidating: false,
  isValid: false,
  pathError: '',
  pathWarning: '',
  hasSettings: false,
  isGitRepo: false
});

const installation = ref({
  status: 'idle' as 'idle' | 'running' | 'success' | 'error',
  output: '',
  error: ''
});

const testEvent = ref({
  status: 'idle' as 'idle' | 'sending' | 'sent' | 'error'
});

const serverUrl = computed(() => `${API_URL}/events`);

const canProceed = computed(() => {
  if (currentStep.value === 1) {
    return validation.value.isValid && formData.value.projectName.trim() !== '';
  }
  return true;
});

async function validatePath() {
  const path = formData.value.projectPath.trim();
  if (!path) {
    validation.value.isValid = false;
    validation.value.pathError = '';
    validation.value.pathWarning = '';
    return;
  }

  validation.value.isValidating = true;
  validation.value.pathError = '';
  validation.value.pathWarning = '';
  validation.value.isValid = false;

  try {
    const response = await fetch(`${API_URL}/api/validate-path`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path })
    });

    const result = await response.json();

    if (!result.exists) {
      validation.value.pathError = 'Directory does not exist';
      validation.value.isValid = false;
    } else {
      validation.value.isValid = true;
      validation.value.hasSettings = result.hasSettings;
      validation.value.isGitRepo = result.isGitRepo;

      // Auto-suggest project name if empty
      if (result.suggestedName && !formData.value.projectName) {
        formData.value.projectName = result.suggestedName;
      }

      // Show warning if settings already exist
      if (result.hasSettings) {
        validation.value.pathWarning = 'This project already has .claude/settings.json. A backup will be created before overwriting.';
      }
    }
  } catch (error: any) {
    validation.value.pathError = 'Failed to validate path: ' + error.message;
    validation.value.isValid = false;
  } finally {
    validation.value.isValidating = false;
  }
}

async function handleNext() {
  if (currentStep.value === 1) {
    currentStep.value = 2;
  } else if (currentStep.value === 2) {
    // Execute installation
    await executeInstallation();
    currentStep.value = 3;
  }
}

function handleBack() {
  if (currentStep.value > 1) {
    currentStep.value -= 1;
  }
}

function handleClose() {
  if (installation.value.status !== 'running') {
    emit('close');
    // Reset wizard state
    setTimeout(() => {
      currentStep.value = 1;
      formData.value.projectPath = '';
      formData.value.projectName = '';
      validation.value.isValid = false;
      validation.value.pathError = '';
      validation.value.pathWarning = '';
      installation.value.status = 'idle';
      installation.value.output = '';
      installation.value.error = '';
      testEvent.value.status = 'idle';
    }, 300);
  }
}

async function executeInstallation() {
  installation.value.status = 'running';
  installation.value.output = 'Starting installation...\n';
  installation.value.error = '';

  try {
    const response = await fetch(`${API_URL}/api/install-hooks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectPath: formData.value.projectPath,
        projectName: formData.value.projectName,
        serverUrl: serverUrl.value
      })
    });

    const result = await response.json();

    installation.value.output += result.output || '';

    if (result.success) {
      installation.value.status = 'success';
    } else {
      installation.value.status = 'error';
      installation.value.error = result.error || 'Unknown error occurred';
    }
  } catch (error: any) {
    installation.value.status = 'error';
    installation.value.error = 'Failed to install hooks: ' + error.message;
    installation.value.output += '\nError: ' + error.message;
  }
}

async function handleTestEvent() {
  testEvent.value.status = 'sending';

  try {
    const response = await fetch(`${API_URL}/api/test-hook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectName: formData.value.projectName
      })
    });

    const result = await response.json();

    if (result.success) {
      testEvent.value.status = 'sent';
    } else {
      testEvent.value.status = 'error';
    }
  } catch (error) {
    testEvent.value.status = 'error';
  }
}
</script>
