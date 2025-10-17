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
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md bg-white rounded-3xl shadow-[0_8px_40px_rgba(0,0,0,0.12)] border-0">
        <CardHeader className="space-y-6 pt-12">
          <div className="flex justify-center">
            <div className="h-20 w-20 rounded-3xl bg-primary flex items-center justify-center shadow-lg">
              <Activity className="h-10 w-10 text-white" />
            </div>
          </div>
          <div className="text-center space-y-2">
            <CardTitle className="text-3xl">DevOps Dashboard</CardTitle>
            <CardDescription>
              Sign in to manage your applications
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="pb-12">
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <Alert variant="destructive" className="rounded-2xl border-0 bg-red-50">
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
                className="rounded-2xl h-12 bg-secondary border-0"
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
                className="rounded-2xl h-12 bg-secondary border-0"
              />
            </div>

            <Button
              type="submit"
              className="w-full bg-accent hover:bg-accent/90 text-accent-foreground rounded-full h-12 mt-6"
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
