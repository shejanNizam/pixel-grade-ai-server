import path from "path";
import swaggerJsdoc from "swagger-jsdoc";

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Pixel Grade AI API",
      version: "1.0.0",
      description:
        "Pixel Grade AI backend — Express + MongoDB + TypeScript API with auth, OTP, file upload, and real-time support.",
    },
    servers: [
      { url: "http://localhost:5000/api/v1", description: "Local development" },
      { url: "https://your-domain.com/api/v1", description: "Production" },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Access token obtained from /auth/login",
        },
        cookieAuth: {
          type: "apiKey",
          in: "cookie",
          name: "refreshToken",
          description: "Refresh token stored in httpOnly cookie",
        },
      },
      schemas: {
        SuccessResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
            message: { type: "string", example: "Operation successful" },
            data: { type: "object" },
          },
        },
        ErrorResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: false },
            message: { type: "string", example: "Something went wrong" },
            errorDetails: { type: "object" },
          },
        },
        ValidationError: {
          type: "object",
          properties: {
            success: { type: "boolean", example: false },
            message: { type: "string", example: "Validation failed" },
            errorDetails: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  field: { type: "string" },
                  message: { type: "string" },
                },
              },
            },
          },
        },
        User: {
          type: "object",
          properties: {
            _id: { type: "string", example: "64a1b2c3d4e5f6a7b8c9d0e1" },
            name: { type: "string", example: "John Doe" },
            email: { type: "string", format: "email", example: "john@example.com" },
            phone: { type: "string", example: "+8801712345678" },
            role: { type: "string", enum: ["user", "admin", "super_admin"], example: "user" },
            avatar: {
              type: "object",
              properties: {
                url: { type: "string" },
                publicId: { type: "string" },
              },
            },
            isEmailVerified: { type: "boolean", example: false },
            status: { type: "string", enum: ["active", "blocked"], example: "active" },
            isDeleted: { type: "boolean", example: false },
            lastLoginAt: { type: "string", format: "date-time" },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        RegisterRequest: {
          type: "object",
          required: ["name", "email", "password"],
          properties: {
            name: { type: "string", minLength: 2, maxLength: 50, example: "John Doe" },
            email: { type: "string", format: "email", example: "john@example.com" },
            password: {
              type: "string",
              minLength: 8,
              example: "SecurePass1!",
              description:
                "Min 8 chars, must include uppercase, number, and special character",
            },
            phone: { type: "string", example: "+8801712345678" },
          },
        },
        LoginRequest: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email: { type: "string", format: "email", example: "john@example.com" },
            password: { type: "string", example: "SecurePass1!" },
          },
        },
        LoginResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
            message: { type: "string", example: "Login successful" },
            data: {
              type: "object",
              properties: {
                accessToken: { type: "string" },
                user: { $ref: "#/components/schemas/User" },
              },
            },
          },
        },
        ChangePasswordRequest: {
          type: "object",
          required: ["oldPassword", "newPassword"],
          properties: {
            oldPassword: { type: "string", example: "OldPass1!" },
            newPassword: { type: "string", example: "NewPass2@" },
          },
        },
        SetPasswordRequest: {
          type: "object",
          required: ["password"],
          properties: {
            password: { type: "string", example: "NewPass1!" },
          },
        },
        ForgotPasswordRequest: {
          type: "object",
          required: ["email"],
          properties: {
            email: { type: "string", format: "email", example: "john@example.com" },
          },
        },
        ResetPasswordRequest: {
          type: "object",
          required: ["password"],
          properties: {
            password: { type: "string", example: "ResetPass1!" },
          },
        },
        SendOtpRequest: {
          type: "object",
          required: ["email"],
          properties: {
            email: { type: "string", format: "email", example: "john@example.com" },
          },
        },
        VerifyOtpRequest: {
          type: "object",
          required: ["email", "otp"],
          properties: {
            email: { type: "string", format: "email", example: "john@example.com" },
            otp: {
              type: "string",
              pattern: "^\\d{6}$",
              example: "123456",
              description: "6-digit numeric OTP",
            },
          },
        },
        UpdateUserRequest: {
          type: "object",
          properties: {
            name: { type: "string", minLength: 2, maxLength: 50, example: "Jane Doe" },
            phone: { type: "string", example: "+8801798765432" },
          },
        },
        UploadResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
            message: { type: "string", example: "File(s) uploaded successfully" },
            data: {
              oneOf: [
                {
                  type: "object",
                  properties: {
                    url: { type: "string" },
                    publicId: { type: "string" },
                  },
                },
                {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      url: { type: "string" },
                      publicId: { type: "string" },
                    },
                  },
                },
              ],
            },
          },
        },
      },
    },
    tags: [
      { name: "Auth", description: "Authentication & authorization" },
      { name: "User", description: "User management" },
      { name: "OTP", description: "One-time password for email verification" },
      { name: "Upload", description: "File uploads via Cloudinary" },
      { name: "Device Token", description: "Push notification device tokens" },
    ],
  },
  apis: [path.join(__dirname, "../modules/**/*.route.*")],
};

export const swaggerSpec = swaggerJsdoc(options);
