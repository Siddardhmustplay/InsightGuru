const API_BASE_URL = 'http://localhost:5000';

export interface UploadResponse {
  message: string;
  db_path: string;
  error?: string;
}

export interface AskResponse {
  sql_query: string;
  preview: any;
  chart: string;
  error?: string;
}

export const uploadFile = async (file: File): Promise<UploadResponse> => {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${API_BASE_URL}/upload`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Upload failed: ${response.statusText}`);
  }

  return response.json();
};

export const askQuestion = async (
  prompt: string, 
  dbPath: string, 
  provider = 'OpenAI', 
  model = 'gpt-4'
): Promise<AskResponse> => {
  const response = await fetch(`${API_BASE_URL}/ask`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      db_path: dbPath,
      provider,
      model
    }),
  });

  if (!response.ok) {
    throw new Error(`Ask failed: ${response.statusText}`);
  }

  return response.json();
};