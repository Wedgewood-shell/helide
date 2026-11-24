%define version 0.20.3.1
%global debug_package %{nil}

Name:    helide-bin
Summary: Helide - personal Helium fork for Linux on Motobook 60 Pro
Version: %{version}
Release: 1%{?dist}
Group:   web
License: GPL-3.0
URL:     https://github.com/sortedcord/helide
Source0: https://github.com/sortedcord/helide/releases/download/%{version}/helide-%{version}-x86_64_linux.tar.xz
Source1: https://github.com/sortedcord/helide/releases/download/%{version}/helide-%{version}-arm64_linux.tar.xz
Source2: net.imput.helide.metainfo.xml

%if 0%{?debbuild}
Packager: sortedcord
Provides: www-browser
%endif

# Based on chrome/installer/linux/{debian,rpm}/additional_deps
# We do not recommend libgtk* because we don't use it by default.
# If the user wants GTK, they can install the relevant lib
# (and they already likely have them installed by default on a desktop install anyways).
Recommends: ca-certificates, xdg-utils
%if 0%{?debbuild}
Recommends: fonts-liberation, libvulkan1
%else
Recommends: liberation-fonts, vulkan-loader
%endif

%description
Helide is a personal Helium fork tailored for Linux on Motobook 60 Pro,
with Wayland transparency, touchpad page transitions, Linux Energy Saver
and background AI-agent access. Not an official Helium or Motorola product.

%prep
%ifarch x86_64 amd64
%setup -q -n helide-%{version}-x86_64_linux
%endif

%ifarch aarch64 arm64
%setup -q -T -b 1 -n helide-%{version}-arm64_linux
%endif

%build
# We are using prebuilt binaries

%install
%define helium_base /opt/helide
%define heliumdir %{buildroot}%{helium_base}

mkdir -p %{heliumdir} \
         %{buildroot}%{_bindir} \
         %{buildroot}%{_datadir}/applications \
         %{buildroot}%{_datadir}/metainfo \
         %{buildroot}%{_datadir}/icons/hicolor/256x256/apps

cp -a . %{heliumdir}

%if 0%{?debbuild}
sed -Ei "s/(CHROME_VERSION_EXTRA=).*/\1deb/" \
    %{heliumdir}/helide-wrapper
%else
sed -Ei "s/(CHROME_VERSION_EXTRA=).*/\1rpm/" \
    %{heliumdir}/helide-wrapper
%endif

install -m 644 product_logo_256.png \
    %{buildroot}%{_datadir}/icons/hicolor/256x256/apps/helide.png

install -m 644 %{heliumdir}/helide.desktop \
    %{buildroot}%{_datadir}/applications/

install -m 644 %{SOURCE2} \
    %{buildroot}%{_datadir}/metainfo/net.imput.helide.metainfo.xml

ln -sf %{helium_base}/helide-wrapper \
    %{buildroot}%{_bindir}/helide

%files
%defattr(-,root,root,-)
%{helium_base}/
%{_bindir}/helide
%{_datadir}/applications/helide.desktop
%{_datadir}/metainfo/net.imput.helide.metainfo.xml
%{_datadir}/icons/hicolor/256x256/apps/helide.png

%post
# Refresh icon cache and update desktop database
/usr/bin/update-desktop-database > /dev/null 2>&1 || :
/bin/touch --no-create %{_datadir}/icons/hicolor > /dev/null 2>&1 || :

if command -v apparmor_parser > /dev/null 2>&1 && [ -d /etc/apparmor.d ]; then
    cp %{helium_base}/apparmor.cfg /etc/apparmor.d/helide-bin
    apparmor_parser -r -W -T /etc/apparmor.d/helide-bin || :
fi

%postun
# Refresh icon cache and update desktop database
/usr/bin/update-desktop-database > /dev/null 2>&1 || :
case "$1" in
    0|remove|purge)
        /bin/touch --no-create %{_datadir}/icons/hicolor > /dev/null 2>&1
        /usr/bin/gtk-update-icon-cache %{_datadir}/icons/hicolor > /dev/null 2>&1 || :

        if [ -f /etc/apparmor.d/helide-bin ]; then
            if command -v apparmor_parser > /dev/null 2>&1; then
                apparmor_parser -R /etc/apparmor.d/helide-bin || :
            fi
            rm -f /etc/apparmor.d/helide-bin
        fi
        ;;
esac

%posttrans
/usr/bin/gtk-update-icon-cache %{_datadir}/icons/hicolor > /dev/null 2>&1 || :

%changelog
%if "%{_vendor}" != "debbuild"
%autochangelog
%endif
