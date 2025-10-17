import { useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Alert, AlertDescription } from './ui/alert';
import { Activity, Loader2, AlertCircle } from 'lucide-react';
import { LoginCredentials } from '../types/app';

interface LoginPageProps {
  onLogin: (credentials: LoginCredentials) => Promise<boolean>;
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const success = await onLogin({ username, password });
      if (!success) {
        setError('Invalid username or password');
      }
    } catch (err) {
      setError('An error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-4">
          <div className="flex justify-center">
            <div className="h-16 w-16 rounded-lg bg-indigo-600 flex items-center justify-center">
              <Activity className="h-8 w-8 text-white" />
            </div>
          </div>
          <div className="text-center space-y-2">
            <CardTitle>DevOps Dashboard</CardTitle>
            <CardDescription>
              Sign in to manage your applications
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your username"
                required
                autoComplete="username"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                required
                autoComplete="current-password"
              />
            </div>

            <Button
              type="submit"
              className="w-full bg-indigo-600 hover:bg-indigo-700"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                'Sign In'
              )}
            </Button>

            {/* <div className="mt-4 p-3 bg-slate-100 dark:bg-slate-800 rounded-md">
              <p className="text-muted-foreground text-center">
                Demo credentials:
              </p>
              <div className="mt-2 space-y-1 text-center">
                <p className="text-slate-700 dark:text-slate-300">
                  <strong>admin</strong> / admin123 (Admin)
                </p>
                <p className="text-slate-700 dark:text-slate-300">
                  <strong>devops</strong> / devops123 (User)
                </p>
                <p className="text-slate-700 dark:text-slate-300">
                  <strong>user</strong> / user123 (User)
                </p>
              </div>
            </div> */}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
