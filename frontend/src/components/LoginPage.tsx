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
    <div className="min-h-screen flex items-center justify-center p-4 bg-white">
      <Card className="w-full max-w-md bento-card">
        <CardHeader className="space-y-6 pt-12">
          <div className="flex justify-center">
            <div className="h-20 w-20 rounded-xl bg-accent border-3 border-black flex items-center justify-center">
              <Activity className="h-10 w-10 text-black" />
            </div>
          </div>
          <div className="text-center space-y-2">
            <CardTitle>DevOps Dashboard</CardTitle>
            <CardDescription>
              Sign in to manage your applications
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="pb-12">
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <Alert variant="destructive" className="rounded-lg border-2 border-[#EF4444] bg-[#EF4444]/10">
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
                className="rounded-lg h-12 bg-secondary border-2 border-black/10 focus:border-black"
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
                className="rounded-lg h-12 bg-secondary border-2 border-black/10 focus:border-black"
              />
            </div>

            <Button
              type="submit"
              className="w-full bg-accent hover:bg-accent/90 text-accent-foreground border-2 border-black rounded-lg h-12 mt-6"
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
          </form>
        </CardContent>
      </Card>
    </div>
  );
}