import bcrypt from "bcrypt";
import { Types } from "mongoose";
import passport from "passport";
import {
  Strategy as GoogleStrategy,
  Profile,
  VerifyCallback,
} from "passport-google-oauth20";
import { Strategy as LocalStrategy } from "passport-local";
import { configs } from "./index";
import { AuthIdentity } from "../modules/auth_identity/auth_identity.model";
import { IUser, UserRole } from "../modules/user/user.interface";
import { User } from "../modules/user/user.model";

passport.use(
  new LocalStrategy(
    { usernameField: "email", passwordField: "password" },
    async (email: string, password: string, done) => {
      try {
        const user = await User.findOne({ email }).select("+password");
        if (!user) {
          return done(null, false, { message: "User does not exist" });
        }
        if (!user.isEmailVerified) {
          return done(null, false, { message: "Email is not verified" });
        }
        if (user.status === "blocked") {
          return done(null, false, { message: "Account is blocked" });
        }
        if (user.isDeleted) {
          return done(null, false, { message: "Account has been deleted" });
        }
        if (!user.password) {
          return done(null, false, {
            message:
              "No password set. Login with Google first, then set a password.",
          });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
          return done(null, false, { message: "Password does not match" });
        }

        return done(null, user);
      } catch (error) {
        return done(error as Error);
      }
    },
  ),
);

// Only register Google strategy when credentials are provided
const googleClientId = configs.google_client_id;
const googleClientSecret = configs.google_client_secret;
const googleCallbackUrl = configs.google_callback_url;

if (googleClientId && googleClientSecret && googleCallbackUrl) {
  passport.use(
  new GoogleStrategy(
    {
      clientID: googleClientId,
      clientSecret: googleClientSecret,
      callbackURL: googleCallbackUrl,
    },
    async (
      _accessToken: string,
      _refreshToken: string,
      profile: Profile,
      done: VerifyCallback,
    ) => {
      try {
        const email = profile.emails?.[0]?.value;
        if (!email) return done(null, false, { message: "No email from Google" });

        const existingIdentity = await AuthIdentity.findOne({
          provider: "google",
          providerId: profile.id,
        });

        if (existingIdentity) {
          const user = await User.findById(existingIdentity.userId);
          if (!user) return done(null, false, { message: "User not found" });
          if (user.status === "blocked") {
            return done(null, false, { message: "Account is blocked" });
          }
          if (user.isDeleted) {
            return done(null, false, { message: "Account has been deleted" });
          }
          return done(null, user);
        }

        let user = await User.findOne({ email });

        if (user) {
          if (user.status === "blocked") {
            return done(null, false, { message: "Account is blocked" });
          }
          if (user.isDeleted) {
            return done(null, false, { message: "Account has been deleted" });
          }
        } else {
          user = await User.create({
            email,
            name: profile.displayName,
            avatar: { url: profile.photos?.[0]?.value || "", publicId: "" },
            role: UserRole.user,
            isEmailVerified: true,
          });
        }

        await AuthIdentity.create({
          userId: user._id,
          provider: "google",
          providerId: profile.id,
        });

        return done(null, user);
      } catch (error) {
        return done(error);
      }
    },
  ),
);
}

passport.serializeUser((user, done) => {
  const typedUser = user as IUser;
  if (!typedUser._id) {
    return done(new Error("User _id not found during serialization"));
  }
  done(null, typedUser._id);
});

passport.deserializeUser(async (id: Types.ObjectId, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (error) {
    done(error);
  }
});
