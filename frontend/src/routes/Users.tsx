import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/axios';
import { useUser } from '../lib/useUser';
import FormattedDate from '../components/ui/FormattedDate';

interface AdminUser {
  id: string;
  role: string;
  email: string | null;
  createdAt: number;
  isEnabled: boolean;
  hasAiKey: boolean;
  hasBinanceKey: boolean;
  hasBybitKey: boolean;
}

export default function Users() {
  const { user } = useUser();
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ['admin-users'],
    queryFn: async () => {
      const res = await api.get('/users');
      return res.data as AdminUser[];
    },
    enabled: user?.role === 'admin',
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, enable }: { id: string; enable: boolean }) => {
      await api.post(`/users/${id}/${enable ? 'enable' : 'disable'}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
  });

  if (user?.role !== 'admin') return <p>Access denied.</p>;

  const users = data ?? [];

  return (
    <div className="bg-white shadow-md border border-gray-200 rounded p-6 w-full">
      <h2 className="text-xl font-bold mb-4">Users</h2>
      <table className="w-full">
        <thead>
          <tr>
            <th className="text-left">ID</th>
            <th className="text-left">Email</th>
            <th className="text-left">Role</th>
            <th className="text-left">OpenAI Key</th>
            <th className="text-left">Binance Key</th>
            <th className="text-left">Bybit Key</th>
            <th className="text-left">Created</th>
            <th className="text-left">Enabled</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.id}</td>
              <td>{u.email ?? '-'}</td>
              <td>{u.role}</td>
              <td>{u.hasAiKey ? 'Yes' : 'No'}</td>
              <td>{u.hasBinanceKey ? 'Yes' : 'No'}</td>
              <td>{u.hasBybitKey ? 'Yes' : 'No'}</td>
              <td>
                <FormattedDate date={u.createdAt} />
              </td>
              <td>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={u.isEnabled}
                    onChange={() =>
                      toggleMutation.mutate({ id: u.id, enable: !u.isEnabled })
                    }
                  />
                  <div className="ml-2 relative w-10 h-5 bg-gray-200 rounded-full peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 peer-checked:bg-blue-600 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-5 peer-checked:after:border-white" />
                </label>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
