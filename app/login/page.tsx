"use client"; // For components that need React hooks and browser APIs, SSR (server side rendering) has to be disabled. Read more here: https://nextjs.org/docs/pages/building-your-application/rendering/server-side-rendering
 
import { useRouter } from "next/navigation"; // use NextJS router for navigation
import { useEffect } from "react";
import { useApi } from "@/hooks/useApi";
import useLocalStorage from "@/hooks/useLocalStorage";
import { User } from "@/types/user";
import { Button, Form, Input } from "antd";
import { beginAuthRouteTransition } from "@/components/authRouteTransition";
// Optionally, you can import a CSS module or file for additional styling:
// import styles from "@/styles/page.module.css";

interface FormFieldProps {
  username: string;
  password: string;
}
const USERNAME_MAX_LENGTH = 24; // CAN CHANGE USERNAME LENGTH LIMIT ??? FIX IN BACKEND LATER

const Login: React.FC = () => {
  const router = useRouter();
  const apiService = useApi(); // für Requests im Backend
  const [form] = Form.useForm();

  // useLocalStorage hook example use
  // The hook returns an object with the value and two functions
  // Simply choose what you need from the hook:
  const {
    value: token,
    set: setToken, // we need this method to set the value of the token to the one we receive from the POST request to the backend server API
    clear: clearToken,
    // clear: clearToken, // is commented out because we do not need to clear the token when logging in
  } = useLocalStorage<string>("token", ""); // note that the key we are selecting is "token" and the default value we are setting is an empty string
  // if you want to pick a different token, i.e "usertoken", the line above would look as follows: } = useLocalStorage<string>("usertoken", "");

  // deklarieren der userid
  const {
    value: userId,
    set: setUserId,
    clear: clearUserId,
  } = useLocalStorage<string>("userId", "");
  const normalizedToken = typeof token === "string" ? token.trim() : "";
  const normalizedUserId = typeof userId === "string" ? userId.trim() : "";

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

  // handleLogin FUnktion - was passiert, wenn der User auf Login klickt
  const handleLogin = async (values: FormFieldProps) => {
    try {
      // Call the API service and let it handle JSON serialization and error handling
      const response = await apiService.post<User>("/login", values); // von useres auf login geändert
// schickt einen POST request mit username und name zum login

      // Use the useLocalStorage hook that returned a setter function (setToken in line 41) to store the token if available
      if (response.token) {
        setToken(response.token);
      }

      if (response.id) {
        setUserId(String(response.id));
      }

      beginAuthRouteTransition("/dashboard", "login");
      router.replace("/dashboard");
    } catch (error) {
      if (error instanceof Error) {
        alert(`Wrong username or password. Please try again.`); // vorher: `Something went wrong during the login:\n${error.message}
      } else {
        console.error("An unknown error occurred during login.");
      }
    }
  };

  // ab hier kommt was nachher der user sieht also Formular mit username und name Feld sowie einem Login button
return (
    <div className="cabo-background">
        <div className="login-container">
            <div className="form-card">
                <div className="auth-form-header">
                  <h1>Login</h1>
                </div>
                <div className="auth-form-divider" />
                <Form
                    form={form}
                    name="login"
                    size="large"
                    variant="outlined"
                    onFinish={handleLogin}
                    layout="vertical"
                    requiredMark={false}
                >
                    <Form.Item
                        name="username"
                        label={<span className="form-label-required">Username<span className="form-label-required-star">*</span></span>}
                        rules={[
                          { required: true, message: "Please input your username!" },
                          {
                            max: USERNAME_MAX_LENGTH,
                            message: `Username can be max ${USERNAME_MAX_LENGTH} characters.`,
                          },
                        ]}
                    >
                        <Input
                          placeholder="Enter username"
                          maxLength={USERNAME_MAX_LENGTH}
                        />
                    </Form.Item>
                    <Form.Item
                        name="password"
                        label={<span className="form-label-required">Password<span className="form-label-required-star">*</span></span>}
                        rules={[{ required: true, message: "Please input your password!" }]}
                    >
                        <Input
                          type="password"
                          placeholder="Enter password"
                        />
                    </Form.Item>
                    <Form.Item>
                        <Button type="primary" htmlType="submit" className="login-button">
                            Login
                        </Button>
                    </Form.Item>
                    <Form.Item>
                        <Button
                          type="default"
                          className="auth-secondary-nav-btn"
                          onClick={() => router.push("/register")}
                        >
                            {"Register here \u2197"}
                            {/*this unicode makes it visually clear it opens a new page*/}
                        </Button>
                    </Form.Item>
                </Form>
            </div>
        </div>
    </div>
);
};

export default Login;
