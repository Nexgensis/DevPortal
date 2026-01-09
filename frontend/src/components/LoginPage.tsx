import { useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Alert, AlertDescription } from './ui/alert';
import { Activity, Loader2, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';

const API_BASE = 'http://localhost:10000/api';

interface LoginPageProps {
  onLogin: (credentials: { username: string; password: string }) => Promise<boolean>;
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [isMicrosoftLoading, setIsMicrosoftLoading] = useState(false);
  const [error, setError] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const handleMicrosoftLogin = async () => {
    setError('');
    setIsMicrosoftLoading(true);

    try {
      const response = await fetch(`${API_BASE}/auth/microsoft`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to get Microsoft login URL');
      }

      const data = await response.json();

      if (data.url) {
        // Redirect to Microsoft login
        window.location.href = data.url;
      } else {
        throw new Error('No login URL received');
      }
    } catch (err) {
      setError('Failed to initialize Microsoft login: ' + (err instanceof Error ? err.message : 'An error occurred'));
      setIsMicrosoftLoading(false);
    }
  };

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
      setError(err instanceof Error ? err.message : 'Login failed');
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
              Sign in to access the dashboard
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="pb-12">
          <div className="space-y-5">
            {error && (
              <Alert variant="destructive" className="rounded-lg border-2 border-[#EF4444] bg-[#EF4444]/10">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* Microsoft SSO Button */}
            <Button
              type="button"
              onClick={handleMicrosoftLogin}
              className="w-full bg-accent hover:bg-accent/90 text-accent-foreground border-2 border-black rounded-lg h-14 text-base"
              disabled={isMicrosoftLoading || isLoading}
            >
              {isMicrosoftLoading ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Redirecting to Microsoft...
                </>
              ) : (
                <>
                  <svg className="mr-3 h-5 w-5" viewBox="0 0 23 23" fill="none">
                    <rect x="1" y="1" width="10" height="10" fill="#F25022" />
                    <rect x="12" y="1" width="10" height="10" fill="#7FBA00" />
                    <rect x="1" y="12" width="10" height="10" fill="#00A4EF" />
                    <rect x="12" y="12" width="10" height="10" fill="#FFB900" />
                  </svg>
                  Sign in with Microsoft
                </>
              )}
            </Button>

            {/* Divider */}
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-black/20" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-white px-2 text-muted-foreground">Or continue with</span>
              </div>
            </div>

            {/* Username/Password Login */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  type="text"
                  placeholder="Enter your username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="border-2 border-black/10 rounded-lg h-12"
                  required
                  disabled={isLoading || isMicrosoftLoading}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="border-2 border-black/10 rounded-lg h-12"
                  required
                  disabled={isLoading || isMicrosoftLoading}
                />
              </div>
              <Button
                type="submit"
                className="w-full bg-black hover:bg-black/90 text-white border-2 border-black rounded-lg h-12"
                disabled={isLoading || isMicrosoftLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  'Sign in'
                )}
              </Button>
            </form>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
