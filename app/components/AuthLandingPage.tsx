"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, Form, Input } from "antd";
import { beginAuthRouteTransition } from "@/components/authRouteTransition";
import { useApi } from "@/hooks/useApi";
import useLocalStorage from "@/hooks/useLocalStorage";
import { User } from "@/types/user";
import {
  type AuthValidationRules,
  fetchAuthValidationRules,
  getFallbackAuthValidationRules,
  sanitizePasswordInput,
  sanitizeUsernameInput,
  validatePassword,
  validateUsername,
} from "@/utils/authValidation";

interface AuthFormValues {
  username: string;
  password: string;
  bio?: string;
}

const BIO_MAX_LENGTH = 180;
const REGISTER_USERNAME_HINT = "Username must be 1-16 characters and use only A-Z, a-z and 0-9.";
const REGISTER_PASSWORD_HINT = "Password must be 8-32 characters, include at least one uppercase letter and one special symbol and use only A-Z, a-z, 0-9 and !\"#$%&'()*+,-./:;<=>?@[\\\\]^_`{|}~.";

const AuthLandingPage: React.FC = () => {
  const [isRegister, setIsRegister] = useState(false);
  const router = useRouter();
  const apiService = useApi();
  const [form] = Form.useForm<AuthFormValues>();
  const [authRules, setAuthRules] = useState<AuthValidationRules>(getFallbackAuthValidationRules());
  const usernameDraft = Form.useWatch("username", form);
  const passwordDraft = Form.useWatch("password", form);

  const {
    value: token,
    set: setToken,
    clear: clearToken,
  } = useLocalStorage<string>("token", "");

  const {
    value: userId,
    set: setUserId,
    clear: clearUserId,
  } = useLocalStorage<string>("userId", "");

  const normalizedToken = typeof token === "string" ? token.trim() : "";
  const normalizedUserId = typeof userId === "string" ? userId.trim() : "";
  const normalizedUsernameDraft = String(usernameDraft ?? "");
  const normalizedPasswordDraft = String(passwordDraft ?? "");
  const usernameRuleError =
    isRegister && form.isFieldTouched("username")
      ? validateUsername(normalizedUsernameDraft, authRules)
      : null;
  const passwordRuleError =
    isRegister && form.isFieldTouched("password")
      ? validatePassword(normalizedPasswordDraft, authRules)
      : null;

  useEffect(() => {
    form.resetFields();
  }, [form, isRegister]);

  useEffect(() => {
    if (!normalizedToken || !normalizedUserId) {
      return;
    }

    let active = true;
    void apiService
      .getWithAuth<User>(`/users/${encodeURIComponent(normalizedUserId)}`, normalizedToken)
      .then((fetchedUser) => {
        const fetchedId = String((fetchedUser as Partial<User>)?.id ?? "").trim();
        if (!active) return;
        if (!fetchedId || fetchedId !== normalizedUserId) {
          clearToken();
          clearUserId();
          return;
        }
        router.replace("/dashboard");
      })
      .catch((error) => {
        if (!active) return;
        const status = (error as { status?: number })?.status;
        if (status === 401 || status === 403 || status === 404) {
          clearToken();
          clearUserId();
        }
      });

    return () => {
      active = false;
    };
  }, [apiService, normalizedToken, normalizedUserId, router, clearToken, clearUserId]);

  useEffect(() => {
    let active = true;
    void fetchAuthValidationRules(apiService).then((rules) => {
      if (!active) {
        return;
      }
      setAuthRules(rules);
    });
    return () => {
      active = false;
    };
  }, [apiService]);

  const handleSubmit = async (values: AuthFormValues) => {
    try {
      let response: User;
      if (isRegister) {
        const normalizedBio = values.bio?.trim();
        if (normalizedBio && normalizedBio.length > BIO_MAX_LENGTH) {
          form.setFields([
            {
              name: "bio",
              errors: [`Bio can be max ${BIO_MAX_LENGTH} characters.`],
            },
          ]);
          return;
        }
        const payload = {
          username: values.username,
          password: values.password,
          bio: normalizedBio && normalizedBio.length > 0
            ? normalizedBio
            : "This player hasn't added a bio yet.",
        };
        response = await apiService.post<User>("/users", payload);
      } else {
        response = await apiService.post<User>("/login", {
          username: values.username,
          password: values.password,
        });
      }

      if (response.token) {
        setToken(response.token);
      }
      if (response.id) {
        setUserId(String(response.id));
      }

      beginAuthRouteTransition("/dashboard", isRegister ? "register" : "login");
      router.replace("/dashboard");
    } catch (error) {
      if (error instanceof Error) {
        if (isRegister) {
          alert(`Registration failed:\n${error.message}`);
        } else {
          alert("Wrong username or password. Please try again.");
        }
      }
    }
  };

  return (
    <div className="cabo-background">
      <div className="login-container login-landing-container">
        <div className="login-landing-shell">
          <section className="login-hero-panel" aria-label="Welcome">
            <h1 className="login-hero-title">
              {isRegister ? "Join Cabo" : "Welcome to Cabo"}
            </h1>
            <p className="login-hero-subtitle">
              {isRegister
                ? "Train memory, deduction, and bluffing in fast Cabo rounds."
                : "Memorize hidden cards, track swaps, and call Cabo when you believe your score is lowest."}
            </p>
            <div className="login-hero-badges" aria-hidden="true">
              <span className="login-hero-badge">Memory First</span>
              <span className="login-hero-badge">Deduction + Bluffing</span>
              <span className="login-hero-badge">Lowest Score Wins</span>
            </div>
          </section>
          <div className="form-card login-form-card">
            <div className="auth-form-header">
              <h2 className="login-form-title">{isRegister ? "Create Account" : "Sign In"}</h2>
              <p className="login-form-subtitle">
                {isRegister
                  ? "Create your account and jump into the game."
                  : "Continue your session and jump back into the game."}
              </p>
            </div>
            <div className="auth-form-divider" />
            <Form
              form={form}
              name={isRegister ? "register" : "login"}
              size="large"
              variant="outlined"
              onFinish={handleSubmit}
              layout="vertical"
              requiredMark={false}
            >
              <Form.Item
                name="username"
                label={<span className="form-label-required">Username<span className="form-label-required-star">*</span></span>}
                validateStatus={isRegister && usernameRuleError ? "error" : undefined}
                help={isRegister ? (
                  <span className={`auth-input-hint${usernameRuleError ? " auth-input-hint-error" : ""}`}>
                    {REGISTER_USERNAME_HINT}
                  </span>
                ) : undefined}
                rules={[
                  { required: true, message: "Please input your username!" },
                  ...(isRegister
                    ? [{
                        validator: async (_: unknown, value: string | undefined) => {
                          const normalized = String(value ?? "");
                          if (!normalized) {
                            return;
                          }
                          const error = validateUsername(normalized, authRules);
                          if (!error) {
                            return;
                          }
                          throw new Error(" ");
                        },
                      }]
                    : []),
                ]}
              >
                <Input
                  placeholder="Enter username"
                  maxLength={authRules.username.maxLength}
                  onChange={(event) => {
                    const sanitized = sanitizeUsernameInput(event.target.value, authRules);
                    if (sanitized !== event.target.value) {
                      form.setFieldValue("username", sanitized);
                    }
                  }}
                />
              </Form.Item>
              <Form.Item
                name="password"
                label={<span className="form-label-required">Password<span className="form-label-required-star">*</span></span>}
                validateStatus={isRegister && passwordRuleError ? "error" : undefined}
                help={isRegister ? (
                  <span className={`auth-input-hint${passwordRuleError ? " auth-input-hint-error" : ""}`}>
                    {REGISTER_PASSWORD_HINT}
                  </span>
                ) : undefined}
                rules={[
                  { required: true, message: "Please input your password!" },
                  ...(isRegister
                    ? [{
                        validator: async (_: unknown, value: string | undefined) => {
                          const normalized = String(value ?? "");
                          if (!normalized) {
                            return;
                          }
                          const error = validatePassword(normalized, authRules);
                          if (!error) {
                            return;
                          }
                          throw new Error(" ");
                        },
                      }]
                    : []),
                ]}
              >
                <Input
                  type="password"
                  placeholder="Enter password"
                  maxLength={isRegister ? authRules.password.maxLength : undefined}
                  onChange={(event) => {
                    if (!isRegister) {
                      return;
                    }
                    const sanitized = sanitizePasswordInput(event.target.value, authRules);
                    if (sanitized !== event.target.value) {
                      form.setFieldValue("password", sanitized);
                    }
                  }}
                />
              </Form.Item>
              {isRegister ? (
                <Form.Item
                  name="bio"
                  label="Bio"
                  rules={[
                    {
                      max: BIO_MAX_LENGTH,
                      message: `Bio can be max ${BIO_MAX_LENGTH} characters.`,
                    },
                  ]}
                >
                  <Input
                    placeholder="Optional (you can add this later)"
                    maxLength={BIO_MAX_LENGTH}
                    showCount
                  />
                </Form.Item>
              ) : null}
              <Form.Item>
                <Button type="primary" htmlType="submit" className="login-button">
                  {isRegister ? "Register" : "Login"}
                </Button>
              </Form.Item>
              <Form.Item>
                <Button
                  type="default"
                  className="auth-secondary-nav-btn"
                  onClick={() => setIsRegister((prev) => !prev)}
                >
                  {isRegister ? "Switch to Login" : "Switch to Register"}
                </Button>
              </Form.Item>
            </Form>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuthLandingPage;
