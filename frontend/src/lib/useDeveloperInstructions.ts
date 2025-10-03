import { useQuery } from '@tanstack/react-query';
import api from './axios';

export function useDeveloperInstructions() {
  return useQuery({
    queryKey: ['developer-instructions'],
    queryFn: async () => {
      const res = await api.get('/developer-instructions');
      return res.data.instructions as string;
    },
    staleTime: 5 * 60 * 1000,
  });
}
