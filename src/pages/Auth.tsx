import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Activity } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Auth() {
  const { user, loading, signIn, signUp, signInWithGoogle, resetPassword } = useAuth();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const googleAuthEnabled = import.meta.env.VITE_GOOGLE_AUTH_ENABLED === "true";

  const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

  useEffect(() => {
    document.title = "Sign In | SweJobs";
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }
  if (user) return <Navigate to="/jobs" replace />;

  const handleSubmit = async (mode: "login" | "register") => {
    if (!isValidEmail(email)) {
      toast({ title: "Invalid email", description: "Enter a valid email address.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    const fn = mode === "login" ? signIn : signUp;
    const { error } = await fn(email, password);
    setSubmitting(false);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else if (mode === "register") {
      toast({ title: "Check your email", description: "We sent a confirmation link." });
    }
  };

  const handleGoogleSignIn = async () => {
    setSubmitting(true);
    const { error } = await signInWithGoogle();
    setSubmitting(false);
    if (error) {
      toast({ title: "Google sign-in error", description: error.message, variant: "destructive" });
    }
  };

  const handleResetPassword = async () => {
    if (!isValidEmail(email)) {
      toast({ title: "Enter your email first", description: "Provide a valid email to receive a reset link.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    const { error } = await resetPassword(email);
    setSubmitting(false);
    if (error) {
      toast({ title: "Reset failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Reset email sent", description: "Check your inbox for the password reset link." });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-primary">
            <Activity className="h-5 w-5 text-primary-foreground" />
          </div>
          <CardTitle className="font-mono text-xl">SweJobs</CardTitle>
          <CardDescription>Swedish Tech Job Tracker</CardDescription>
        </CardHeader>
        <CardContent>
          {googleAuthEnabled && (
            <div className="mb-4 space-y-4">
              <Button
                type="button"
                variant="outline"
                className="w-full gap-2"
                onClick={handleGoogleSignIn}
                disabled={submitting}
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                  <path fill="#EA4335" d="M12 10.2v3.9h5.4c-.2 1.3-1.5 3.9-5.4 3.9-3.2 0-5.9-2.7-5.9-6s2.7-6 5.9-6c1.8 0 3 .8 3.7 1.5l2.5-2.4C16.6 3.6 14.5 2.7 12 2.7 6.9 2.7 2.7 6.9 2.7 12S6.9 21.3 12 21.3c6.9 0 8.6-4.8 8.6-7.3 0-.5-.1-.9-.1-1.3H12z" />
                </svg>
                Continue with Google
              </Button>
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">or continue with email</span>
                </div>
              </div>
            </div>
          )}

          <Tabs defaultValue="login">
            <TabsList className="w-full">
              <TabsTrigger value="login" className="flex-1">Sign in</TabsTrigger>
              <TabsTrigger value="register" className="flex-1">Register</TabsTrigger>
            </TabsList>

            {(["login", "register"] as const).map((mode) => (
              <TabsContent key={mode} value={mode} className="space-y-4 pt-4">
                <Input
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <Input
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSubmit(mode)}
                />
                {mode === "login" ? (
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-0 text-xs text-muted-foreground hover:text-foreground"
                      onClick={handleResetPassword}
                      disabled={submitting}
                    >
                      Forgot password?
                    </Button>
                  </div>
                ) : null}
                {mode === "register" && (
                  <p className="text-xs text-muted-foreground">Password must be at least 6 characters.</p>
                )}
                <Button
                  className="w-full"
                  disabled={submitting || !isValidEmail(email) || !password}
                  onClick={() => handleSubmit(mode)}
                >
                  {submitting ? "..." : mode === "login" ? "Sign in" : "Create account"}
                </Button>
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
