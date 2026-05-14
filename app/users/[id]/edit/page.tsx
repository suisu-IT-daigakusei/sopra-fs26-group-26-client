"use client"; // sagt next js dass die seite im browser udn nicht auf server ausgeführt wird, (standard ist auf server)
// wegen den react hooks geht es nur im browser 

// S3: neuer Screen der erlaubt dem eingeloggten user sein Passwort zu ändern
// nach änderung soll user ausgeloggt werden und geht zurück zum Login

import React, { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useApi } from "@/hooks/useApi"; // für putequest ans backend
import useLocalStorage from "@/hooks/useLocalStorage"; // um token und userId zu löschen bei ausloggen
import { Button, Form, Input } from "antd"; // ui komponenten
import {
    type AuthValidationRules,
    fetchAuthValidationRules,
    getFallbackAuthValidationRules,
    sanitizePasswordInput,
    validatePassword,
} from "@/utils/authValidation";

const EditPassword: React.FC = () => {
    const router = useRouter(); // für Navigation zu anderen Seiten
    const params = useParams(); // holt id aus der URL
    const apiService = useApi(); // zugriff auf apiservice für Requests ans Backend
    const [form] = Form.useForm();
    const [authRules, setAuthRules] = useState<AuthValidationRules>(getFallbackAuthValidationRules());
    const { clear: clearToken } = useLocalStorage<string>("token", ""); // um token zu löschen bei ausloggen
    const { clear: clearUserId } = useLocalStorage<string>("userId", ""); // um userId zu löschen beiausloggen

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

    const handleSubmit = async (): Promise<void> => {
        const password = form.getFieldValue("password");
        if (!password) {
            alert("Please enter a new password!");
            return;
        }
        const passwordError = validatePassword(String(password), authRules);
        if (passwordError) {
            alert(passwordError);
            return;
        }
        try {
            // schickt putrequest zum backend mit neuem Passwort
            await apiService.put(`/users/${params.id}`, { password: password });

            // nach änderung werden token und userid gelöscht
            clearToken();
            clearUserId();

            window.location.assign("/login");
        } catch (error) {
            // Fehlermeldung anzeigen falls es nicht geht
            if (error instanceof Error) {
                alert(`Something went wrong:\n${error.message}`);
            }
        }
    };

    // was user sieht formular mit neuem passwort Feld
    return (
        <div className="login-container"> {/* Hintergrund mit Bild */}
            <div className="form-card">
                <h1>Password Editor</h1>
                <Form
                    form={form}
                    name="editPassword"
                    size="large"
                    variant="outlined"
                    onFinish={handleSubmit} // ruft handleSubmit auf wenn user auf save klikt
                    layout="vertical"
                >
                    <Form.Item
                        name="password"
                        label="Enter your new password"
                        extra={<span className="auth-input-hint">{authRules.password.hint}</span>}
                        rules={[
                            { required: true, message: "Please enter your new password." },
                            {
                                validator: async (_, value: string | undefined) => {
                                    const normalized = String(value ?? "");
                                    if (!normalized) {
                                        return;
                                    }
                                    const error = validatePassword(normalized, authRules);
                                    if (!error) {
                                        return;
                                    }
                                    throw new Error(error);
                                },
                            },
                        ]}
                    >
                        <Input
                               type="password"
                               placeholder="Enter new password"
                               maxLength={authRules.password.maxLength}
                               onChange={(e) => {
                                   const sanitized = sanitizePasswordInput(e.target.value, authRules);
                                   if (sanitized !== e.target.value) {
                                       form.setFieldValue("password", sanitized);
                                   }
                               }}
                        />
                    </Form.Item>
                    <Form.Item>
                        <Button type="primary" onClick={handleSubmit} className="login-button">
                            Save new password {/* submit Button */}
                        </Button>
                    </Form.Item>
                    <Form.Item>
                        {/* zurück zum Profil ohne zu speichern */}
                        <Button
                            type="default"
                            onClick={() => router.push(`/users/${params.id}`)}
                        >
                            Nope, changed my mind
                        </Button>
                    </Form.Item>
                </Form>
            </div>
        </div>
    );
};

export default EditPassword; // macht die komponente verfügbar für nextjs

