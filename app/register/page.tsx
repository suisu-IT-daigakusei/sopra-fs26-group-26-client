"use client";
import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useApi } from "@/hooks/useApi";
import useLocalStorage from "@/hooks/useLocalStorage";
import { User } from "@/types/user";
import { Button, Form, Input } from "antd";
import { beginAuthRouteTransition } from "@/components/authRouteTransition";

interface FormFieldProps {
    username: string;
    password: string;
    bio?: string;
}
const USERNAME_MAX_LENGTH = 16; // CAN CHANGE USERNAME LENGTH LIMIT >>> FIX IN BACKEND TOO
const BIO_MAX_LENGTH = 180;

const Register: React.FC = () => {
    const router = useRouter();
    const apiService = useApi();
    const [form] = Form.useForm();
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

    const handleRegister = async (values: FormFieldProps) => {
        try {
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
                ...values,
                bio: normalizedBio && normalizedBio.length > 0
                    ? normalizedBio
                    : "This player hasn't added a bio yet.",
            };

            const response = await apiService.post<User>("/users", payload);

            if (response.token) {
                setToken(response.token);
            }
            if (response.id) {
                setUserId(String(response.id));
            }

            beginAuthRouteTransition("/dashboard", "register");
            router.replace("/dashboard");
        } catch (error) {
            if (error instanceof Error) {
                alert(`Registration failed:\n${error.message}`);
            }
        }
    };
return (
    <div className="cabo-background">
        <div className="login-container">
            <div className="form-card">
                <div className="auth-form-header">
                  <h1>Register</h1>
                </div>
                <div className="auth-form-divider" />
                <Form
                    form={form}
                    name="register"
                    size="large"
                    variant="outlined"
                    onFinish={handleRegister}
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
                    <Form.Item>
                        <Button type="primary" htmlType="submit" className="login-button">
                            Register
                        </Button>
                    </Form.Item>
                    <Form.Item>
                        <Button
                          type="default"
                          className="auth-secondary-nav-btn"
                          onClick={() => router.push("/login")}
                        >
                            {"Login here \u2197"}
                            {/* this unicode makes it visually clear it opens a new page */}
                        </Button>
                    </Form.Item>
                </Form>
            </div>
        </div>
    </div>
);
};
export default Register;
