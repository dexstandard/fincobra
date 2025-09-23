export interface AIResponseContent {
  type: string;
  text?: string;
}

export interface AIResponseOutput {
  id?: string;
  type?: string;
  role?: string;
  content?: AIResponseContent[];
}

export interface AIResponse {
  output: AIResponseOutput[];
}
