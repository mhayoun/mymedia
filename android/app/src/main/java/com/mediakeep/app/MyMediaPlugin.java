package com.mediakeep.app;

import android.accounts.Account;
import android.accounts.AccountManager;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.OpenableColumns;

import androidx.activity.result.ActivityResult;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.GoogleAuthUtil;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.Scope;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * What the web app cannot do inside Android: Google sign-in through the
 * phone's accounts (a new token comes back without any click once Drive
 * access was accepted) and the files received from the Share menu.
 */
@CapacitorPlugin(name = "MyMedia")
public class MyMediaPlugin extends Plugin {

    private static final String DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

    private ActivityResultLauncher<IntentSenderRequest> consentLauncher;
    private ActivityResultLauncher<Intent> accountLauncher;
    private PluginCall consentCall;
    private PluginCall accountCall;
    /** Files received from the Share menu, waiting for the app to take them. */
    private final JSArray shared = new JSArray();

    @Override
    public void load() {
        consentLauncher = getActivity().registerForActivityResult(
            new ActivityResultContracts.StartIntentSenderForResult(), this::onConsent);
        accountLauncher = getActivity().registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(), this::onAccountChosen);
        receive(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (receive(intent)) notifyListeners("shared", new JSObject(), true);
    }

    // ---- Google sign-in -------------------------------------------------

    /**
     * Gives a Drive access token. email: the account to use (null = the
     * phone's choice). interactive: may show Google's consent screen;
     * otherwise rejects with "needs_ui" when the user has to accept first.
     */
    @PluginMethod
    public void authorize(PluginCall call) {
        String email = call.getString("email");
        boolean interactive = Boolean.TRUE.equals(call.getBoolean("interactive", false));
        AuthorizationRequest.Builder request = AuthorizationRequest.builder()
            .setRequestedScopes(Collections.singletonList(new Scope(DRIVE_SCOPE)));
        if (email != null && !email.isEmpty()) request.setAccount(new Account(email, "com.google"));
        Identity.getAuthorizationClient(getActivity())
            .authorize(request.build())
            .addOnSuccessListener(result -> {
                if (!result.hasResolution()) {
                    resolveToken(call, result);
                } else if (!interactive || result.getPendingIntent() == null) {
                    call.reject("Google needs the user to accept", "needs_ui");
                } else {
                    consentCall = call;
                    consentLauncher.launch(new IntentSenderRequest.Builder(result.getPendingIntent().getIntentSender()).build());
                }
            })
            .addOnFailureListener(e -> call.reject(e.getMessage(), errorCode(e)));
    }

    private void onConsent(ActivityResult r) {
        PluginCall call = consentCall;
        consentCall = null;
        if (call == null) return;
        try {
            AuthorizationResult result = Identity.getAuthorizationClient(getActivity()).getAuthorizationResultFromIntent(r.getData());
            resolveToken(call, result);
        } catch (ApiException e) {
            call.reject(e.getMessage(), errorCode(e));
        }
    }

    private void resolveToken(PluginCall call, AuthorizationResult result) {
        String token = result.getAccessToken();
        if (token == null) {
            call.reject("No token", "no_token");
            return;
        }
        if (!result.getGrantedScopes().contains(DRIVE_SCOPE)) {
            call.reject("Drive access not granted", "scope_denied");
            return;
        }
        JSObject out = new JSObject();
        out.put("accessToken", token);
        call.resolve(out);
    }

    private static String errorCode(Exception e) {
        if (e instanceof ApiException) {
            int status = ((ApiException) e).getStatusCode();
            // 16 = CANCELED (the user closed Google's screen).
            return status == 16 ? "popup_closed" : "google_" + status;
        }
        return "unknown";
    }

    /** Lets the user pick one of the phone's Google accounts (or add one). */
    @PluginMethod
    public void chooseAccount(PluginCall call) {
        accountCall = call;
        Intent intent = AccountManager.newChooseAccountIntent(
            null, null, new String[] { "com.google" }, null, null, null, null);
        accountLauncher.launch(intent);
    }

    private void onAccountChosen(ActivityResult r) {
        PluginCall call = accountCall;
        accountCall = null;
        if (call == null) return;
        Intent data = r.getData();
        String email = data == null ? null : data.getStringExtra(AccountManager.KEY_ACCOUNT_NAME);
        if (email == null) {
            call.reject("No account chosen", "popup_closed");
            return;
        }
        JSObject out = new JSObject();
        out.put("email", email);
        call.resolve(out);
    }

    /** Forgets a token Google refused (401), so the next authorize gives a new one. */
    @PluginMethod
    public void clearToken(PluginCall call) {
        String token = call.getString("token");
        new Thread(() -> {
            try {
                if (token != null) GoogleAuthUtil.clearToken(getContext(), token);
            } catch (Exception ignored) {
                // Already gone.
            }
            call.resolve();
        }).start();
    }

    // ---- Share menu ------------------------------------------------------

    /** Copies the files of a Share intent into the app's cache; true if there were some. */
    private boolean receive(Intent intent) {
        if (intent == null) return false;
        String action = intent.getAction();
        List<Uri> uris = new ArrayList<>();
        if (Intent.ACTION_SEND.equals(action)) {
            Uri uri = Build.VERSION.SDK_INT >= 33
                ? intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class)
                : intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (uri != null) uris.add(uri);
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ArrayList<Uri> list = Build.VERSION.SDK_INT >= 33
                ? intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri.class)
                : intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (list != null) uris.addAll(list);
        } else {
            return false;
        }
        // Taken once: a restart of the activity must not add them again.
        intent.setAction(Intent.ACTION_MAIN);
        File dir = new File(getContext().getCacheDir(), "shared");
        dir.mkdirs();
        int n = 0;
        for (Uri uri : uris) {
            try {
                String name = displayName(uri);
                File out = new File(dir, System.nanoTime() + "-" + name.replaceAll("[/\\\\]", "_"));
                try (InputStream in = getContext().getContentResolver().openInputStream(uri);
                     OutputStream os = new FileOutputStream(out)) {
                    if (in == null) continue;
                    byte[] buf = new byte[1 << 16];
                    int k;
                    while ((k = in.read(buf)) > 0) os.write(buf, 0, k);
                }
                JSObject f = new JSObject();
                f.put("path", out.getAbsolutePath());
                f.put("name", name);
                f.put("type", getContext().getContentResolver().getType(uri));
                f.put("modified", out.lastModified());
                shared.put(f);
                n++;
            } catch (Exception e) {
                android.util.Log.w("MyMedia", "shared file not read: " + uri, e);
            }
        }
        return n > 0;
    }

    private String displayName(Uri uri) {
        try (Cursor c = getContext().getContentResolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst() && !c.isNull(0)) return c.getString(0);
        } catch (Exception ignored) {
            // Fall back to the last part of the address.
        }
        String last = uri.getLastPathSegment();
        return last == null ? "shared" : last;
    }

    /** The files received from the Share menu and not yet taken. */
    @PluginMethod
    public void getShared(PluginCall call) {
        JSObject out = new JSObject();
        out.put("files", shared);
        call.resolve(out);
    }

    /** Forgets the received files (after the app has uploaded them or the user closed the window). */
    @PluginMethod
    public void clearShared(PluginCall call) {
        while (shared.length() > 0) shared.remove(0);
        File[] files = new File(getContext().getCacheDir(), "shared").listFiles();
        if (files != null) for (File f : files) f.delete();
        call.resolve();
    }
}
